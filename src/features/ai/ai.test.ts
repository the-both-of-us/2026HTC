import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getVercelOidcToken } from "@vercel/oidc";
import { AiUnavailableError, chatJSON, chatText } from "./index";

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn() }));

const CEREBRAS = "https://api.cerebras.ai/v1/chat/completions";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";
const GATEWAY = "https://ai-gateway.vercel.sh/v1/chat/completions";

const schema = z.object({ answer: z.number() });
const base = { prompt: "What is 6 times 7?", label: "test" };

/** A successful provider response whose reply text is `content`. */
function reply(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

function failure(status: number): Response {
  return new Response("secret provider details", { status });
}

/** Makes fetch return these in order, and fail the test run if it is called again. */
function mockFetch(...results: Array<Response | Error>) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = results.shift();
    if (!next) throw new Error("fetch was called more times than expected");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function urls(fetchMock: ReturnType<typeof mockFetch>): unknown[] {
  return fetchMock.mock.calls.map((call) => call[0]);
}

function body(fetchMock: ReturnType<typeof mockFetch>, callIndex: number) {
  return JSON.parse(fetchMock.mock.calls[callIndex][1]?.body as string);
}

function header(fetchMock: ReturnType<typeof mockFetch>, callIndex: number, name: string) {
  return (fetchMock.mock.calls[callIndex][1]?.headers as Record<string, string>)[name];
}

beforeEach(() => {
  vi.stubEnv("CEREBRAS_API_KEY", "cerebras-key");
  vi.stubEnv("GROQ_API_KEY", "groq-key");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
  vi.mocked(getVercelOidcToken).mockReset().mockResolvedValue("oidc-token");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fallback order", () => {
  it("uses Cerebras first and stops when it answers", async () => {
    const fetchMock = mockFetch(reply("hello"));

    expect(await chatText(base)).toBe("hello");
    expect(urls(fetchMock)).toEqual([CEREBRAS]);
    expect(header(fetchMock, 0, "Authorization")).toBe("Bearer cerebras-key");
    expect(body(fetchMock, 0).model).toBe("gpt-oss-120b");
  });

  it("goes Cerebras, Groq, then Gateway, on 429 and 5xx", async () => {
    const fetchMock = mockFetch(failure(429), failure(503), reply("hello"));

    expect(await chatText(base)).toBe("hello");
    expect(urls(fetchMock)).toEqual([CEREBRAS, GROQ, GATEWAY]);
    expect(header(fetchMock, 1, "Authorization")).toBe("Bearer groq-key");
    expect(body(fetchMock, 1).model).toBe("openai/gpt-oss-120b");
    expect(header(fetchMock, 2, "Authorization")).toBe("Bearer oidc-token");
    expect(body(fetchMock, 2).model).toBe("openai/gpt-oss-120b");
  });

  it("tries the next route on a 402", async () => {
    const fetchMock = mockFetch(failure(402), reply("hello"));

    expect(await chatText(base)).toBe("hello");
    expect(urls(fetchMock)).toEqual([CEREBRAS, GROQ]);
  });

  it("tries the next route on a network error", async () => {
    const fetchMock = mockFetch(new TypeError("fetch failed"), reply("hello"));

    expect(await chatText(base)).toBe("hello");
    expect(urls(fetchMock)).toEqual([CEREBRAS, GROQ]);
  });

  it("tries the next route when a request times out", async () => {
    vi.stubEnv("GROQ_API_KEY", "");

    // The first call waits until its abort signal fires, like a stuck provider.
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
      if (url === GATEWAY) return reply("hello");
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await chatText({ ...base, timeoutMs: 10 })).toBe("hello");
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([CEREBRAS, GATEWAY]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("timeout"));
  });

  it("skips routes that have no key", async () => {
    vi.stubEnv("CEREBRAS_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    const fetchMock = mockFetch(reply("hello"));

    expect(await chatText(base)).toBe("hello");
    expect(urls(fetchMock)).toEqual([GATEWAY]);
  });

  it("uses VERCEL_OIDC_TOKEN when getVercelOidcToken fails", async () => {
    vi.stubEnv("CEREBRAS_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "local-token");
    vi.mocked(getVercelOidcToken).mockRejectedValue(new Error("no token"));
    const fetchMock = mockFetch(reply("hello"));

    await chatText(base);

    expect(header(fetchMock, 0, "Authorization")).toBe("Bearer local-token");
  });

  it("logs which route served the call and how long it took", async () => {
    mockFetch(reply("hello"));

    await chatText(base);

    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/test: served by cerebras in \d+ms/));
  });
});

describe("request details", () => {
  it("asks for JSON mode on Cerebras only, and only from chatJSON", async () => {
    const fetchMock = mockFetch(failure(429), reply('{"answer":42}'));
    await chatJSON({ ...base, schema });
    expect(body(fetchMock, 0).response_format).toEqual({ type: "json_object" });
    expect(body(fetchMock, 1).response_format).toBeUndefined();

    const textFetchMock = mockFetch(reply("hello"));
    await chatText(base);
    expect(body(textFetchMock, 0).response_format).toBeUndefined();
  });

  it("sends the system prompt, the schema and maxTokens", async () => {
    const fetchMock = mockFetch(reply('{"answer":42}'));

    await chatJSON({ ...base, schema, system: "Be brief.", maxTokens: 100 });

    const sent = body(fetchMock, 0);
    expect(sent.max_tokens).toBe(100);
    expect(sent.messages[0].role).toBe("system");
    expect(sent.messages[0].content).toContain("Be brief.");
    expect(sent.messages[0].content).toContain('"answer"');
    expect(sent.messages[1]).toEqual({ role: "user", content: base.prompt });
  });
});

describe("JSON handling", () => {
  it("strips code fences", async () => {
    mockFetch(reply('```json\n{"answer":42}\n```'));

    expect(await chatJSON({ ...base, schema })).toEqual({ answer: 42 });
  });

  it("retries malformed JSON once on the same provider, with the error appended", async () => {
    const fetchMock = mockFetch(reply("not json at all"), reply('{"answer":42}'));

    expect(await chatJSON({ ...base, schema })).toEqual({ answer: 42 });
    expect(urls(fetchMock)).toEqual([CEREBRAS, CEREBRAS]);
    const retryPrompt = body(fetchMock, 1).messages.at(-1).content;
    expect(retryPrompt).toContain(base.prompt);
    expect(retryPrompt).toContain("not valid JSON");
  });

  it("retries a reply that does not match the schema, naming the problem", async () => {
    const fetchMock = mockFetch(reply('{"answer":"forty-two"}'), reply('{"answer":42}'));

    expect(await chatJSON({ ...base, schema })).toEqual({ answer: 42 });
    expect(urls(fetchMock)).toEqual([CEREBRAS, CEREBRAS]);
    expect(body(fetchMock, 1).messages.at(-1).content).toContain("answer");
  });

  it("moves to the next route after the retry also fails", async () => {
    const fetchMock = mockFetch(reply("bad"), reply("still bad"), reply('{"answer":42}'));

    expect(await chatJSON({ ...base, schema })).toEqual({ answer: 42 });
    expect(urls(fetchMock)).toEqual([CEREBRAS, CEREBRAS, GROQ]);
  });
});

describe("when everything fails", () => {
  it("throws AiUnavailableError with a human message and no provider text", async () => {
    const fetchMock = mockFetch(failure(500), failure(429), failure(402));

    const error = await chatText(base).catch((caught) => caught);

    expect(error).toBeInstanceOf(AiUnavailableError);
    expect(error.message).toMatch(/try again/i);
    expect(error.message).not.toContain("secret");
    expect(urls(fetchMock)).toEqual([CEREBRAS, GROQ, GATEWAY]);
  });

  it("also throws it from chatJSON when every reply is malformed", async () => {
    mockFetch(reply("a"), reply("b"), reply("c"), reply("d"), reply("e"), reply("f"));

    await expect(chatJSON({ ...base, schema })).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("also throws it when no route has credentials", async () => {
    vi.stubEnv("CEREBRAS_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.mocked(getVercelOidcToken).mockRejectedValue(new Error("no token"));
    const fetchMock = mockFetch();

    await expect(chatText(base)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops at a 400, because the next provider would reject the request too", async () => {
    const fetchMock = mockFetch(failure(400));

    await expect(chatText(base)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(urls(fetchMock)).toEqual([CEREBRAS]);
  });
});
