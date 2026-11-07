import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deepgramProvider,
  elevenLabsProvider,
  geminiProvider,
  ProviderError,
  providersFromEnv,
  sharedProviders,
  speakWithFailover,
  type FetchLike,
  type TtsProvider,
} from "./tts";

const signal = new AbortController().signal;
const audioResponse = () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });

function bodiesOf(fetchFn: ReturnType<typeof vi.fn>) {
  return fetchFn.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse((init as RequestInit).body as string),
    headers: (init as RequestInit).headers as Record<string, string>,
  }));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("elevenLabsProvider", () => {
  it("asks for eleven_v4_turbo on the stream endpoint first", async () => {
    const fetchFn = vi.fn(async () => audioResponse());
    const provider = elevenLabsProvider({ apiKey: "k", voiceId: "v", fetchFn: fetchFn as unknown as FetchLike });
    const audio = await provider.speak("Hello", signal);
    expect(audio.contentType).toBe("audio/mpeg");
    const [call] = bodiesOf(fetchFn);
    expect(call.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v/stream?output_format=mp3_44100_128");
    expect(call.body).toEqual({ text: "Hello", model_id: "eleven_v4_turbo" });
    expect(call.headers["xi-api-key"]).toBe("k");
  });

  it("moves to the next route when a model is refused, and remembers the winner", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      String(url).includes("text-to-speech") && fetchFn.mock.calls.length === 1
        ? new Response("{}", { status: 422 })
        : audioResponse(),
    );
    const provider = elevenLabsProvider({ apiKey: "k", voiceId: "v", fetchFn: fetchFn as unknown as FetchLike });
    await provider.speak("Hello", signal);
    const calls = bodiesOf(fetchFn);
    expect(calls[1].url).toContain("/v1/text-to-dialogue/stream");
    expect(calls[1].body).toEqual({ inputs: [{ text: "Hello", voice_id: "v" }], model_id: "eleven_v4" });

    await provider.speak("Again", signal);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(bodiesOf(fetchFn)[2].url).toContain("/v1/text-to-dialogue/stream");
  });

  it("does not waste calls on other routes when the account itself is the problem", async () => {
    for (const status of [401, 402, 429, 500, 503]) {
      const fetchFn = vi.fn(async () => new Response("{}", { status }));
      const provider = elevenLabsProvider({ apiKey: "k", voiceId: "v", fetchFn: fetchFn as unknown as FetchLike });
      await expect(provider.speak("Hello", signal)).rejects.toBeInstanceOf(ProviderError);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("uses only the pinned model when one is set", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 422 }));
    const provider = elevenLabsProvider({ apiKey: "k", voiceId: "v", model: "pinned", fetchFn: fetchFn as unknown as FetchLike });
    await expect(provider.speak("Hello", signal)).rejects.toBeInstanceOf(ProviderError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(bodiesOf(fetchFn)[0].body.model_id).toBe("pinned");
  });
});

describe("geminiProvider", () => {
  it("decodes the WAV from the interactions response", async () => {
    const data = Buffer.from("RIFF-audio").toString("base64");
    const fetchFn = vi.fn(async () =>
      Response.json({ steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "audio", data }] }] }),
    );
    const audio = await geminiProvider({ apiKey: "g", fetchFn: fetchFn as unknown as FetchLike }).speak("Hi", signal);
    expect(audio.contentType).toBe("audio/wav");
    expect(await new Response(audio.body).text()).toBe("RIFF-audio");
    const [call] = bodiesOf(fetchFn);
    expect(call.url).toContain("/v1beta/interactions");
    expect(call.body.model).toBe("gemini-3.8-flash-tts");
    expect(call.headers["x-goog-api-key"]).toBe("g");
  });

  it("fails when the response has no audio", async () => {
    const fetchFn = vi.fn(async () => Response.json({ steps: [] }));
    await expect(geminiProvider({ apiKey: "g", fetchFn: fetchFn as unknown as FetchLike }).speak("Hi", signal)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });
});

describe("speakWithFailover", () => {
  const audio = { body: new Blob([]).stream(), contentType: "audio/wav" };
  const failing: TtsProvider = {
    name: "A",
    speak: async () => {
      throw new ProviderError("A", 500);
    },
  };
  const working: TtsProvider = { name: "B", speak: async () => audio };

  it("returns the first provider that works", async () => {
    await expect(speakWithFailover([failing, working], "x", signal)).resolves.toBe(audio);
  });

  it("returns null when all fail, and logs no secrets", async () => {
    await expect(speakWithFailover([failing], "secret words", signal)).resolves.toBeNull();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret words");
  });

  it("gives up on a provider that hangs", async () => {
    vi.useFakeTimers();
    const hanging: TtsProvider = {
      name: "H",
      speak: (_text, attemptSignal) =>
        new Promise((_, reject) => attemptSignal.addEventListener("abort", () => reject(new Error("aborted")))),
    };
    const result = speakWithFailover([hanging, working], "x", signal);
    await vi.advanceTimersByTimeAsync(8_001);
    await expect(result).resolves.toBe(audio);
    vi.useRealTimers();
  });

  it("stops when the listener has gone", async () => {
    const gone = new AbortController();
    gone.abort();
    await expect(speakWithFailover([working], "x", gone.signal)).resolves.toBeNull();
  });
});

describe("deepgramProvider", () => {
  it("asks Flux for Hannah as MP3 and streams the body back", async () => {
    const fetchFn = vi.fn(async () => audioResponse());
    const provider = deepgramProvider({ apiKey: "k", fetchFn: fetchFn as unknown as FetchLike });
    const audio = await provider.speak("Hello", signal);
    expect(audio.contentType).toBe("audio/mpeg");
    const [call] = bodiesOf(fetchFn);
    expect(call.url).toBe("https://api.deepgram.com/v2/speak?model=flux-hannah-en&encoding=mp3");
    expect(call.body).toEqual({ text: "Hello" });
    expect(call.headers.Authorization).toBe("Token k");
  });

  it("throws a ProviderError with the status when Deepgram refuses", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 401 }));
    const provider = deepgramProvider({ apiKey: "k", fetchFn: fetchFn as unknown as FetchLike });
    await expect(provider.speak("Hello", signal)).rejects.toMatchObject({ status: 401, provider: "Deepgram" });
  });
});

describe("providersFromEnv", () => {
  it("is empty without keys", () => {
    expect(providersFromEnv({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(providersFromEnv({ ELEVENLABS_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("puts ElevenLabs first, and Gemini as the failover", () => {
    const env = { ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v", GEMINI_API_KEY: "g" } as unknown as NodeJS.ProcessEnv;
    expect(providersFromEnv(env).map((p) => p.name)).toEqual(["ElevenLabs", "Gemini"]);
    expect(providersFromEnv({ GEMINI_API_KEY: "g" } as unknown as NodeJS.ProcessEnv).map((p) => p.name)).toEqual(["Gemini"]);
  });

  it("puts Deepgram's voice ahead of the others when its key is set", () => {
    const env = { DEEPGRAM_API_KEY: "d", ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v", GEMINI_API_KEY: "g" } as unknown as NodeJS.ProcessEnv;
    expect(providersFromEnv(env).map((p) => p.name)).toEqual(["Deepgram", "ElevenLabs", "Gemini"]);
  });
});

describe("sharedProviders", () => {
  it("keeps one provider across requests, so a refused model is only tried once", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      String(url).includes("/v1/text-to-speech/") ? new Response("{}", { status: 422 }) : audioResponse(),
    );
    vi.stubGlobal("fetch", fetchFn);
    try {
      const env = { ELEVENLABS_API_KEY: "shared-test", ELEVENLABS_VOICE_ID: "v" } as unknown as NodeJS.ProcessEnv;
      await sharedProviders(env)[0].speak("First request", signal);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      await sharedProviders(env)[0].speak("Second request", signal);
      expect(fetchFn).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("follows a change of settings", () => {
    const first = sharedProviders({ GEMINI_API_KEY: "a" } as unknown as NodeJS.ProcessEnv);
    expect(sharedProviders({ GEMINI_API_KEY: "a" } as unknown as NodeJS.ProcessEnv)).toBe(first);
    expect(sharedProviders({ GEMINI_API_KEY: "b" } as unknown as NodeJS.ProcessEnv)).not.toBe(first);
  });
});
