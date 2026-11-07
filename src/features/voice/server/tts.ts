/**
 * Text to speech providers behind one small interface. The server is the only caller,
 * and it only ever passes text it stored itself.
 */

export type SpeechAudio = { body: ReadableStream<Uint8Array>; contentType: string };

export type TtsProvider = {
  name: string;
  /** Resolves when audio starts arriving. Throws if this provider can't speak right now. */
  speak(text: string, signal: AbortSignal): Promise<SpeechAudio>;
};

export type FetchLike = typeof fetch;

/** How long a provider gets to start answering before we try the next one. */
const FIRST_BYTE_TIMEOUT_MS = 8_000;

/** Tries each provider in order, and returns the first that starts producing audio. */
export async function speakWithFailover(
  providers: readonly TtsProvider[],
  text: string,
  signal: AbortSignal,
): Promise<SpeechAudio | null> {
  for (const provider of providers) {
    if (signal.aborted) return null;
    const attempt = new AbortController();
    const stopAttempt = () => attempt.abort();
    signal.addEventListener("abort", stopAttempt, { once: true });
    const timer = setTimeout(stopAttempt, FIRST_BYTE_TIMEOUT_MS);
    try {
      return await provider.speak(text, attempt.signal);
    } catch (error) {
      signal.removeEventListener("abort", stopAttempt);
      // Only the provider's name and status: never a key or the request.
      console.error(`[voice] ${provider.name} could not speak: ${describe(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** A provider said no. Carries the status so we can tell "wrong model" from "out of service". */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} returned ${status}`);
    this.name = "ProviderError";
  }
}

function describe(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  return error instanceof Error ? error.name : "unknown error";
}

const ELEVENLABS_FORMAT = "mp3_44100_128";

type ElevenLabsRoute =
  | { kind: "speech"; model: string }
  /** Eleven's docs list the v4 family under Text to Dialogue. One speaker is a valid dialogue. */
  | { kind: "dialogue"; model: string };

/**
 * Best sounding first. Eleven's docs recommend eleven_v4_turbo for real-time, but only
 * describe it under Text to Dialogue, so it might be refused on this endpoint. A refusal
 * moves to the next route rather than losing the voice, and the winner is remembered.
 */
const DEFAULT_ROUTES: readonly ElevenLabsRoute[] = [
  { kind: "speech", model: "eleven_v4_turbo" },
  { kind: "dialogue", model: "eleven_v4" },
  { kind: "speech", model: "eleven_multilingual_v2" },
];

/** A refusal of the request itself. A 401, 402, 429 or 5xx means every route would fail too. */
const WRONG_ROUTE = new Set([400, 404, 405, 422]);

export function elevenLabsProvider(options: {
  apiKey: string;
  voiceId: string;
  model?: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
}): TtsProvider {
  const base = options.baseUrl ?? "https://api.elevenlabs.io";
  const fetchFn = options.fetchFn ?? fetch;
  const routes: ElevenLabsRoute[] = options.model
    ? [{ kind: "speech", model: options.model }]
    : [...DEFAULT_ROUTES];
  let start = 0;

  async function call(route: ElevenLabsRoute, text: string, signal: AbortSignal): Promise<Response> {
    const voice = encodeURIComponent(options.voiceId);
    const url =
      route.kind === "speech"
        ? `${base}/v1/text-to-speech/${voice}/stream?output_format=${ELEVENLABS_FORMAT}`
        : `${base}/v1/text-to-dialogue/stream?output_format=${ELEVENLABS_FORMAT}`;
    const body =
      route.kind === "speech"
        ? { text, model_id: route.model }
        : { inputs: [{ text, voice_id: options.voiceId }], model_id: route.model };
    return fetchFn(url, {
      method: "POST",
      headers: { "xi-api-key": options.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(body),
      signal,
    });
  }

  return {
    name: "ElevenLabs",
    async speak(text, signal) {
      for (let i = start; i < routes.length; i++) {
        const response = await call(routes[i], text, signal);
        if (response.ok && response.body) {
          start = i;
          return { body: response.body, contentType: "audio/mpeg" };
        }
        void response.body?.cancel();
        if (!WRONG_ROUTE.has(response.status) || i === routes.length - 1) {
          throw new ProviderError("ElevenLabs", response.status);
        }
        console.error(`[voice] ElevenLabs refused ${routes[i].model} on ${routes[i].kind} (${response.status}), trying the next.`);
      }
      throw new ProviderError("ElevenLabs", 0);
    },
  };
}

export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";

type GeminiStep = { type?: string; content?: { type?: string; data?: string }[] };

/**
 * The failover voice. It isn't streamed: the unary call returns a whole WAV file, which
 * is simpler and only ever matters when ElevenLabs is down.
 * https://ai.google.dev/gemini-api/docs/speech-generation (checked 2026-11-07)
 */
export function geminiProvider(options: { apiKey: string; baseUrl?: string; fetchFn?: FetchLike }): TtsProvider {
  const base = options.baseUrl ?? "https://generativelanguage.googleapis.com";
  const fetchFn = options.fetchFn ?? fetch;
  return {
    name: "Gemini",
    async speak(text, signal) {
      const response = await fetchFn(`${base}/v1beta/interactions`, {
        method: "POST",
        headers: { "x-goog-api-key": options.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GEMINI_TTS_MODEL,
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text,
                  annotations: [{ type: "speech_metadata", style: "calm, clear and professional" }],
                },
              ],
            },
          ],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: "Kore" }] },
        }),
        signal,
      });
      if (!response.ok) throw new ProviderError("Gemini", response.status);
      const json = (await response.json()) as { steps?: GeminiStep[] };
      const audio = (json.steps ?? [])
        .filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .filter((part) => part.type === "audio" && part.data)
        .at(-1);
      if (!audio?.data) throw new ProviderError("Gemini", 502);
      const bytes = Uint8Array.from(Buffer.from(audio.data, "base64"));
      return { body: new Blob([bytes]).stream(), contentType: "audio/wav" };
    },
  };
}

/** The providers that have keys, best first. Empty means voice is off, and routes answer 503. */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): TtsProvider[] {
  const providers: TtsProvider[] = [];
  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) {
    providers.push(
      elevenLabsProvider({
        apiKey: env.ELEVENLABS_API_KEY,
        voiceId: env.ELEVENLABS_VOICE_ID,
        model: env.ELEVENLABS_MODEL_ID || undefined,
        baseUrl: env.ELEVENLABS_API_BASE || undefined,
      }),
    );
  }
  if (env.GEMINI_API_KEY) {
    providers.push(geminiProvider({ apiKey: env.GEMINI_API_KEY, baseUrl: env.GEMINI_API_BASE || undefined }));
  }
  return providers;
}
