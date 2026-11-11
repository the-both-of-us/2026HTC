import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiRefusedError, AiUnavailableError, chatJSON, chatText, modelId, modelLabel, PROFILES, streamLines } from "./index";

const sdk = vi.hoisted(() => ({ stream: vi.fn(), options: [] as unknown[] }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { stream: sdk.stream };
    constructor(options: unknown) {
      sdk.options.push(options);
    }
  },
}));

type Script = {
  /** Text deltas, in order. */
  chunks?: string[];
  stopReason?: string;
  /** Thinking deltas sent before the text. */
  thinking?: number;
  /** Wait this long (timer) before the first event. */
  waitMs?: number;
  /** Throw this instead of finishing, after the chunks. */
  error?: unknown;
  /** Never finish. */
  hang?: boolean;
};

/** The fake stream the SDK would return: an async iterator of events plus finalMessage(). */
function fakeStream(script: Script) {
  const events: unknown[] = [
    ...Array.from({ length: script.thinking ?? 0 }, () => ({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } })),
    ...(script.chunks ?? []).map((text) => ({ type: "content_block_delta", delta: { type: "text_delta", text } })),
  ];
  const finish = async () => {
    if (script.waitMs) await new Promise((resolve) => setTimeout(resolve, script.waitMs));
    if (script.hang) await new Promise(() => {});
  };
  return {
    async *[Symbol.asyncIterator]() {
      await finish();
      for (const event of events) yield event;
      if (script.error) throw script.error;
    },
    finalMessage: async () => {
      await finish();
      if (script.error) throw script.error;
      return { stop_reason: script.stopReason ?? "end_turn", model: "claude-haiku-5-5", content: [] };
    },
  };
}

/** Each call to messages.stream gets the next script. */
function script(...scripts: Script[]) {
  const queue = [...scripts];
  sdk.stream.mockImplementation(() => {
    const next = queue.shift();
    if (!next) throw new Error("messages.stream was called more times than expected");
    return fakeStream(next);
  });
}

const body = (call = 0) => sdk.stream.mock.calls[call][0] as Record<string, unknown>;
const schema = z.object({ answer: z.number() });
const base = { prompt: "What is 6 times 7?", label: "test" };
const apiError = (status: number, retryAfter?: string) =>
  Object.assign(new Error("secret provider details"), { status, headers: new Headers(retryAfter ? { "retry-after": retryAfter } : {}) });

beforeEach(() => {
  sdk.stream.mockReset();
  sdk.options.length = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_MODEL", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("request body per profile", () => {
  const expected = {
    plan: { thinking: { type: "adaptive" }, effort: "high", max_tokens: 32_000 },
    write: { thinking: { type: "adaptive" }, effort: "low", max_tokens: 12_000 },
    check: { thinking: { type: "disabled" }, effort: "low", max_tokens: 2_000 },
  } as const;

  for (const profile of ["plan", "write", "check"] as const) {
    it(`${profile}: thinking, effort and max_tokens, and none of the parameters Haiku 5.5 rejects`, async () => {
      script({ chunks: ["hello"] });
      expect(await chatText({ ...base, profile, system: "Be brief." })).toBe("hello");

      const sent = body();
      expect(sent.model).toBe("claude-haiku-5-5");
      expect(sent.thinking).toEqual(expected[profile].thinking);
      expect(sent.output_config).toEqual({ effort: expected[profile].effort });
      expect(sent.max_tokens).toBe(expected[profile].max_tokens);
      expect(sent.system).toBe("Be brief.");
      expect(sent.messages).toEqual([{ role: "user", content: base.prompt }]);
      for (const banned of ["temperature", "top_p", "top_k", "fallbacks", "betas", "stream"]) expect(sent).not.toHaveProperty(banned);
      // The last message is the user's: no prefill.
      expect((sent.messages as { role: string }[]).at(-1)?.role).toBe("user");
    });
  }

  it("builds the client with SDK retries off", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fresh-key"); // the client is cached per key
    script({ chunks: ["hi"] });
    await chatText({ ...base, profile: "check" });
    expect(sdk.options[0]).toMatchObject({ apiKey: "fresh-key", maxRetries: 0 });
  });

  it("takes the model from ANTHROPIC_MODEL", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-5-6");
    script({ chunks: ["hi"] });
    await chatText({ ...base, profile: "check" });
    expect(body().model).toBe("claude-haiku-5-6");
    expect(modelId()).toBe("claude-haiku-5-6");
  });

  it("lets a caller lower maxTokens but never raise it past the profile", async () => {
    script({ chunks: ["a"] }, { chunks: ["b"] });
    await chatText({ ...base, profile: "write", maxTokens: 3000 });
    await chatText({ ...base, profile: "write", maxTokens: 99_999 });
    expect(body(0).max_tokens).toBe(3000);
    expect(body(1).max_tokens).toBe(PROFILES.write.maxTokens);
  });

  it("does not call the API without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(chatText({ ...base, profile: "check" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).not.toHaveBeenCalled();
  });
});

describe("chatJSON", () => {
  it("adds the schema to the system prompt and returns the validated object", async () => {
    script({ chunks: ['{"answer":', "42}"] });
    const onServed = vi.fn();
    expect(await chatJSON({ ...base, profile: "check", system: "You grade.", schema, onServed })).toEqual({ answer: 42 });
    expect(body().system).toContain("You grade.");
    expect(body().system).toContain('"answer"');
    expect(onServed).toHaveBeenCalledWith(expect.objectContaining({ route: "anthropic", model: "claude-haiku-5-5" }));
  });

  it("accepts JSON inside a code fence or after a sentence", async () => {
    script({ chunks: ['```json\n{"answer": 1}\n```'] }, { chunks: ['Sure! {"answer": 2} Hope that helps.'] });
    expect(await chatJSON({ ...base, profile: "check", schema })).toEqual({ answer: 1 });
    expect(await chatJSON({ ...base, profile: "check", schema })).toEqual({ answer: 2 });
  });

  it("repairs a bad reply once, with the error appended to the prompt", async () => {
    script({ chunks: ['{"answer":"x"}'] }, { chunks: ['{"answer": 7}'] });
    expect(await chatJSON({ ...base, profile: "check", schema })).toEqual({ answer: 7 });
    expect(sdk.stream).toHaveBeenCalledTimes(2);
    expect(String((body(1).messages as { content: string }[])[0].content)).toContain("Your previous reply was rejected");
  });

  it("gives up after two bad replies", async () => {
    script({ chunks: ["nope"] }, { chunks: ["still nope"] });
    await expect(chatJSON({ ...base, profile: "check", schema })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).toHaveBeenCalledTimes(2);
  });

  it("skips the repair when less than 5 s of the call is left", async () => {
    vi.useFakeTimers();
    script({ chunks: ["nope"], waitMs: 12_000 }, { chunks: ['{"answer": 1}'] });
    const result = chatJSON({ ...base, profile: "write", totalMs: 15_000, schema });
    const caught = result.catch((error) => error);
    await vi.advanceTimersByTimeAsync(13_000);
    expect(await caught).toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  it("gives the repair only the time that is left", async () => {
    vi.useFakeTimers();
    script({ chunks: ["nope"], waitMs: 8_000 }, { chunks: ['{"answer": 1}'], waitMs: 30_000 });
    const caught = chatJSON({ ...base, profile: "write", totalMs: 15_000, schema }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(7_100);
    expect(await caught).toBeInstanceOf(AiUnavailableError);
  });

  it("treats max_tokens as a failure, with no repair", async () => {
    script({ chunks: ['{"answer": 4'], stopReason: "max_tokens" });
    await expect(chatJSON({ ...base, profile: "check", schema })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  it("treats a refusal as AiRefusedError, with no retry", async () => {
    script({ chunks: [], stopReason: "refusal" });
    await expect(chatJSON({ ...base, profile: "check", schema })).rejects.toBeInstanceOf(AiRefusedError);
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  it("reads only text blocks: thinking deltas never reach the reply", async () => {
    script({ thinking: 3, chunks: ['{"answer": 5}'] });
    expect(await chatJSON({ ...base, profile: "plan", schema })).toEqual({ answer: 5 });
  });
});

describe("chatText", () => {
  it("fails on max_tokens and on an empty reply", async () => {
    script({ chunks: ["half a sent"], stopReason: "max_tokens" }, { chunks: ["  "] });
    await expect(chatText({ ...base, profile: "write" })).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(chatText({ ...base, profile: "write" })).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

describe("retries", () => {
  it("retries once after a fast 429, waiting for retry-after", async () => {
    script({ error: apiError(429, "0") }, { chunks: ["ok"] });
    expect(await chatText({ ...base, profile: "check" })).toBe("ok");
    expect(sdk.stream).toHaveBeenCalledTimes(2);
  });

  it("retries once after a fast 5xx, 529 or connection error", async () => {
    const connection = Object.assign(new Error("fetch failed"), { name: "APIConnectionError" });
    script({ error: apiError(503, "0") }, { chunks: ["a"] }, { error: apiError(529, "0") }, { chunks: ["b"] }, { error: connection }, { chunks: ["c"] });
    expect(await chatText({ ...base, profile: "check" })).toBe("a");
    expect(await chatText({ ...base, profile: "check" })).toBe("b");
    expect(await chatText({ ...base, profile: "check" })).toBe("c");
  });

  it("caps the retry-after wait at 5 s", async () => {
    vi.useFakeTimers();
    script({ error: apiError(429, "60") }, { chunks: ["ok"] });
    const result = chatText({ ...base, profile: "write" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBe("ok");
  });

  it("does not retry a 400 or a 401", async () => {
    script({ error: apiError(400) }, { error: apiError(401) });
    await expect(chatText({ ...base, profile: "check" })).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(chatText({ ...base, profile: "check" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).toHaveBeenCalledTimes(2);
  });

  it("does not retry twice", async () => {
    script({ error: apiError(500, "0") }, { error: apiError(500, "0") });
    await expect(chatText({ ...base, profile: "check" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failure that came after 10 s", async () => {
    vi.useFakeTimers();
    script({ waitMs: 11_000, error: apiError(529, "0") }, { chunks: ["late"] });
    const caught = chatText({ ...base, profile: "write" }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await caught).toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  it("does not retry once text has started", async () => {
    script({ chunks: ["partial"], error: apiError(503, "0") }, { chunks: ["again"] });
    await expect(chatText({ ...base, profile: "check" })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });

  it("never puts provider text in the error", async () => {
    script({ error: apiError(400) });
    const error = await chatText({ ...base, profile: "check" }).catch((e) => e);
    expect(error.message).not.toContain("secret");
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain("secret");
  });
});

describe("timeouts", () => {
  it("fails a check call that shows no text within 10 s, even if it keeps thinking", async () => {
    vi.useFakeTimers();
    script({ thinking: 2, hang: true });
    const caught = chatText({ ...base, profile: "check" }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10_100);
    expect(await caught).toBeInstanceOf(AiUnavailableError);
  });

  it("fails a call that streams past the total timeout", async () => {
    vi.useFakeTimers();
    const slow = fakeStream({ chunks: ["start"] });
    sdk.stream.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "start" } };
        await new Promise(() => {});
      },
      finalMessage: slow.finalMessage,
    });
    const caught = chatText({ ...base, profile: "write", totalMs: 20_000 }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(20_100);
    expect(await caught).toBeInstanceOf(AiUnavailableError);
  });
});

describe("streamLines", () => {
  const line = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("head"), title: z.string() }),
    z.object({ kind: z.literal("unit"), id: z.string() }),
  ]);
  const run = (onLine = vi.fn()) => streamLines({ profile: "plan", label: "test-lines", system: "Plan it.", prompt: "go", line, onLine });

  it("hands over each line as soon as its newline arrives, across split chunks", async () => {
    script({ chunks: ['{"kind":"he', 'ad","title":"T"}\n{"kind":"un', 'it","id":"u1"}\n'] });
    const seen: [unknown, number][] = [];
    const result = await run(vi.fn((l, i) => void seen.push([l, i])));
    expect(seen).toEqual([
      [{ kind: "head", title: "T" }, 0],
      [{ kind: "unit", id: "u1" }, 1],
    ]);
    expect(result).toEqual({ lines: [{ kind: "head", title: "T" }, { kind: "unit", id: "u1" }], rejected: [], truncated: false });
  });

  it("appends the JSON Lines instruction to the system prompt", async () => {
    script({ chunks: ['{"kind":"head","title":"T"}'] });
    await run();
    expect(String(body().system)).toBe("Plan it.\n\nReply with JSON Lines: one JSON object per line, no prose, no code fences.");
    expect(body().thinking).toEqual({ type: "adaptive" });
  });

  it("skips blank lines and code fences, and handles a last line with no newline", async () => {
    script({ chunks: ['```json\n\n{"kind":"head","title":"A"}\n', '\n{"kind":"unit","id":"u9"}\n```'] });
    const result = await run();
    expect(result.lines).toHaveLength(2);
    expect(result.rejected).toEqual([]);
  });

  it("collects a bad line in rejected and carries on", async () => {
    script({ chunks: ['{"kind":"head","title":"A"}\nnot json at all\n{"kind":"unit"}\n{"kind":"unit","id":"u2"}\n'] });
    const onLine = vi.fn();
    const result = await run(onLine);
    expect(result.lines.map((l) => l.kind)).toEqual(["head", "unit"]);
    expect(result.rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(result.rejected[0].reason).toContain("JSON");
    expect(onLine).toHaveBeenCalledTimes(2);
  });

  it("awaits onLine in order, so a slow store write is never overtaken", async () => {
    script({ chunks: ['{"kind":"unit","id":"a"}\n{"kind":"unit","id":"b"}\n{"kind":"unit","id":"c"}\n'] });
    const done: string[] = [];
    const slowFirst = vi.fn(async (l: { id?: string }) => {
      await new Promise((resolve) => setTimeout(resolve, l.id === "a" ? 30 : 1));
      done.push(l.id!);
    });
    await run(slowFirst);
    expect(done).toEqual(["a", "b", "c"]);
  });

  it("rejects streamLines with the error onLine threw", async () => {
    script({ chunks: ['{"kind":"unit","id":"a"}\n{"kind":"unit","id":"b"}\n'] });
    const boom = new Error("store down");
    const onLine = vi.fn().mockRejectedValue(boom);
    await expect(run(onLine)).rejects.toBe(boom);
    expect(onLine).toHaveBeenCalledTimes(1);
  });

  it("reports truncation and keeps the complete lines", async () => {
    script({ chunks: ['{"kind":"head","title":"A"}\n{"kind":"unit","id":"u'], stopReason: "max_tokens" });
    const result = await run();
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.rejected).toEqual([{ index: 1, reason: "cut off at max_tokens" }]);
  });

  it("throws AiRefusedError on a refusal and AiUnavailableError on an empty reply", async () => {
    script({ chunks: [], stopReason: "refusal" }, { chunks: ["\n"] });
    await expect(run()).rejects.toBeInstanceOf(AiRefusedError);
    await expect(run()).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("retries a fast 429 before any text, but not after lines were handed over", async () => {
    script({ error: apiError(429, "0") }, { chunks: ['{"kind":"unit","id":"a"}\n'] });
    expect((await run()).lines).toHaveLength(1);

    sdk.stream.mockReset();
    script({ chunks: ['{"kind":"unit","id":"a"}\n'], error: apiError(503, "0") }, { chunks: ['{"kind":"unit","id":"a"}\n'] });
    const onLine = vi.fn();
    await expect(run(onLine)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(sdk.stream).toHaveBeenCalledTimes(1);
  });
});

describe("modelLabel", () => {
  it("names the model for people", () => {
    expect(modelLabel("claude-haiku-5-5")).toBe("Claude Haiku");
    expect(modelLabel("something-else")).toBe("something-else");
  });
});
