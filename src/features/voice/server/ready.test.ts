import { describe, expect, it, vi } from "vitest";
import { isVoiceReady } from "./ready";

function answering(status: number) {
  return vi.fn(async () => new Response("{}", { status }));
}

describe("isVoiceReady", () => {
  it("is false with no key, and asks nobody", async () => {
    const fetchFn = answering(200);
    expect(await isVoiceReady({}, fetchFn)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is true when Deepgram mints a token, and remembers it", async () => {
    const fetchFn = answering(200);
    const env = { DEEPGRAM_API_KEY: "good", DEEPGRAM_API_BASE: "http://fake.test" };
    expect(await isVoiceReady(env, fetchFn)).toBe(true);
    expect(await isVoiceReady(env, fetchFn)).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn.mock.calls[0]).toEqual(["http://fake.test/v1/auth/grant", expect.objectContaining({ method: "POST" })]);
  });

  it("is false when Deepgram refuses the key or can't be reached", async () => {
    expect(await isVoiceReady({ DEEPGRAM_API_KEY: "wrong-role" }, answering(403))).toBe(false);
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await isVoiceReady({ DEEPGRAM_API_KEY: "unreachable" }, down)).toBe(false);
  });
});
