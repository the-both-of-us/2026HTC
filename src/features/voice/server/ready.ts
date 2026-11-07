/**
 * Whether voice can work right now. The map page asks before it shows any voice control,
 * so a judge never sees a microphone button that leads nowhere.
 */
import type { FetchLike } from "./tts";

/** A working key stays working, so one check covers a few minutes of page loads. */
const READY_FOR_MS = 5 * 60_000;
/** A failure is checked again sooner, so fixing the key shows up quickly. */
const NOT_READY_FOR_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_500;

let cached: { key: string; ready: boolean; until: number } | null = null;

/**
 * True when the Deepgram key is set and Deepgram mints a browser token with it. The ears
 * need that token, and the same key speaks the question, so this one check covers both.
 * Minting a token costs nothing, and the token is thrown away.
 */
export async function isVoiceReady(env: Record<string, string | undefined> = process.env, fetchFn: FetchLike = fetch): Promise<boolean> {
  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) return false;
  const key = `${apiKey}|${env.DEEPGRAM_API_BASE ?? ""}`;
  if (cached?.key === key && Date.now() < cached.until) return cached.ready;

  let ready = false;
  try {
    const base = env.DEEPGRAM_API_BASE || "https://api.deepgram.com";
    const response = await fetchFn(`${base}/v1/auth/grant`, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 30 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    ready = response.ok;
    if (!ready) console.error(`[voice] the readiness check got ${response.status} from Deepgram`);
  } catch (error) {
    console.error(`[voice] the readiness check failed: ${error instanceof Error ? error.name : "unknown"}`);
  }

  cached = { key, ready, until: Date.now() + (ready ? READY_FOR_MS : NOT_READY_FOR_MS) };
  return ready;
}
