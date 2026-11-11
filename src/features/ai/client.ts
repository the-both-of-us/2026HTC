import Anthropic from "@anthropic-ai/sdk";

let cached: { key: string; client: Anthropic } | null = null;

/**
 * The one Anthropic client. `maxRetries: 0`: chat.ts retries once itself, and only when the
 * failure was quick (SDK retries would hide slow failures behind the learner's wait).
 * Returns null when ANTHROPIC_API_KEY is unset.
 */
export function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  // fetch is looked up on every request, so a test or an eval tap that swaps globalThis.fetch still sees the call.
  const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 0, fetch }) };
  return cached.client;
}
