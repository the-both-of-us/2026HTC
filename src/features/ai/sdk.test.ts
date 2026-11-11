import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiRefusedError, AiUnavailableError, chatJSON, streamLines } from "./index";
import { parseJsonLine } from "./lines";
import { anthropicError, anthropicStreamResponse, readAnthropicRequest } from "./testing";

/** The real SDK client, with only fetch replaced: proves the request and the stream parsing against the actual library. */
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "sdk-test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the real SDK over a stubbed fetch", () => {
  it("sends the plan profile as a streaming Messages request and reads the text", async () => {
    const requests: { url: string; headers: Headers; body: ReturnType<typeof readAnthropicRequest> }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers), body: readAnthropicRequest(init) });
      return anthropicStreamResponse(['{"answer"', ": 42}"]);
    }) as typeof fetch;

    const answer = await chatJSON({ profile: "plan", label: "sdk", prompt: "6 x 7?", schema: z.object({ answer: z.number() }) });

    expect(answer).toEqual({ answer: 42 });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(requests[0].headers.get("authorization")).toBe("Bearer sdk-test-key");
    expect(requests[0].body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 32_000,
      stream: true,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
    expect(requests[0].body).not.toHaveProperty("temperature");
  });

  it("streams lines through the real parser", async () => {
    globalThis.fetch = (async () => anthropicStreamResponse(['{"n":1}\n{"n"', ":2}\n", '{"n":3}'])) as typeof fetch;
    const seen: number[] = [];
    const result = await streamLines({
      profile: "check",
      label: "sdk-lines",
      system: "s",
      prompt: "p",
      line: z.object({ n: z.number() }),
      onLine: (line) => void seen.push(line.n),
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
  });

  it("reads the line slips Haiku makes (measured Nov 2026), and still rejects what is not JSON", async () => {
    globalThis.fetch = (async () =>
      anthropicStreamResponse([
        '{"n":1},\n',
        '[{"n":2}, {"n":3}]\n',
        '{"n":4}\\n{"n":5}\n',
        '{"n":6,"s":"a \\" } \\\\n { quote"}\\n{"n":7}\n',
        'Here are the lines:\n',
        '{"n":8',
      ])) as typeof fetch;
    const seen: number[] = [];
    const result = await streamLines({
      profile: "check",
      label: "sdk-lines",
      system: "s",
      prompt: "p",
      line: z.object({ n: z.number() }),
      onLine: (line) => void seen.push(line.n),
    });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.rejected.map((r) => r.reason)).toEqual(["not valid JSON", "not valid JSON"]);
  });

  it("lets a caller lower the profile's effort, never raise it", async () => {
    const bodies: ReturnType<typeof readAnthropicRequest>[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(readAnthropicRequest(init));
      return anthropicStreamResponse('{"n":1}');
    }) as typeof fetch;
    const line = z.object({ n: z.number() });
    await streamLines({ profile: "plan", label: "x", system: "s", prompt: "p", line, effort: "medium", onLine: () => {} });
    await streamLines({ profile: "check", label: "x", system: "s", prompt: "p", line, effort: "high", onLine: () => {} });
    expect(bodies.map((body) => (body as { output_config: { effort: string } }).output_config.effort)).toEqual(["medium", "low"]);
  });

  it("maps a refusal and a max_tokens stop", async () => {
    globalThis.fetch = (async () => anthropicStreamResponse("", { stopReason: "refusal" })) as typeof fetch;
    await expect(chatJSON({ profile: "check", label: "sdk", prompt: "p", schema: z.object({}) })).rejects.toBeInstanceOf(AiRefusedError);

    globalThis.fetch = (async () => anthropicStreamResponse('{"a":', { stopReason: "max_tokens" })) as typeof fetch;
    await expect(chatJSON({ profile: "check", label: "sdk", prompt: "p", schema: z.object({}) })).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("retries one fast 429 with the SDK's own error object, and stops at a 400", async () => {
    const replies = [() => anthropicError(429, { "retry-after": "0" }), () => anthropicStreamResponse('{"ok":true}')];
    const fetchMock = vi.fn(async () => replies.shift()!());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await chatJSON({ profile: "check", label: "sdk", prompt: "p", schema: z.object({ ok: z.boolean() }) })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset().mockImplementation(async () => anthropicError(400));
    await expect(chatJSON({ profile: "check", label: "sdk", prompt: "p", schema: z.object({}) })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a fast 529 and a connection error", async () => {
    const replies: (() => Response | Promise<Response>)[] = [
      () => anthropicError(529, { "retry-after": "0" }),
      () => anthropicStreamResponse("a"),
      () => {
        throw new TypeError("fetch failed");
      },
      () => anthropicStreamResponse("b"),
    ];
    globalThis.fetch = (async () => replies.shift()!()) as typeof fetch;
    const text = (await import("./index")).chatText;
    expect(await text({ profile: "check", label: "sdk", prompt: "p" })).toBe("a");
    expect(await text({ profile: "check", label: "sdk", prompt: "p" })).toBe("b");
  });
});

describe("parseJsonLine", () => {
  it("closes an object the model ended with a written-out \\n and no brace", () => {
    expect(parseJsonLine('{"part":"idea","text":"One."\\n{"part":"idea","text":"Two."}')).toEqual([
      { part: "idea", text: "One." },
      { part: "idea", text: "Two." },
    ]);
  });

  it("returns null for prose, a cut-off object or text between objects", () => {
    expect(parseJsonLine("Sure, here it is")).toBeNull();
    expect(parseJsonLine('{"a":1')).toBeNull();
    expect(parseJsonLine('{"a":1} and {"b":2}')).toBeNull();
  });
});
