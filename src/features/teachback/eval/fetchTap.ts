import type { ModelCall } from "./metrics";

/**
 * Reads token counts and raw replies without changing grading.ts: it wraps fetch, copies
 * what comes back and passes the real response on. It keeps only the host name from the
 * request, so no key can reach the results file.
 */
export type TappedCall = ModelCall & { reply: string | null };

export function startFetchTap(): { take: () => TappedCall[]; stop: () => void } {
  const realFetch = globalThis.fetch;
  let calls: TappedCall[] = [];

  globalThis.fetch = async (input, init) => {
    const startedAt = Date.now();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const response = await realFetch(input, init);
    const ms = Date.now() - startedAt;

    const body = await response
      .clone()
      .json()
      .catch(() => null);
    calls.push({
      host: url.host,
      status: response.status,
      ms,
      promptTokens: body?.usage?.prompt_tokens ?? 0,
      completionTokens: body?.usage?.completion_tokens ?? 0,
      reply: body?.choices?.[0]?.message?.content ?? null,
    });
    return response;
  };

  return {
    take() {
      const taken = calls;
      calls = [];
      return taken;
    },
    stop() {
      globalThis.fetch = realFetch;
    },
  };
}

/** Pulls the quotes out of a raw grader reply. Empty if the reply was not valid JSON. */
export function quotesInReply(reply: string | null): string[] {
  if (!reply) return [];
  try {
    const parsed = JSON.parse(reply.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return parsed.checkpoints
      .map((item: { quote?: unknown }) => item.quote)
      .filter((quote: unknown) => typeof quote === "string");
  } catch {
    return [];
  }
}
