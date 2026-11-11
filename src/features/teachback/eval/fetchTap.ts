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

    const parsed = await response
      .clone()
      .text()
      .then(readAnthropicStream)
      .catch(() => ({ promptTokens: 0, completionTokens: 0, reply: null }));
    calls.push({ host: url.host, status: response.status, ms, ...parsed });
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

type StreamEvent = {
  type?: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { output_tokens?: number };
  delta?: { type?: string; text?: string };
};

/**
 * Reads an Anthropic `POST /v1/messages` reply, streamed (server-sent events, as the SDK asks for)
 * or plain JSON: input tokens from message_start, output tokens from the last message_delta, and
 * the text deltas joined. Thinking deltas are not part of the reply.
 */
export function readAnthropicStream(body: string): Pick<TappedCall, "promptTokens" | "completionTokens" | "reply"> {
  let promptTokens = 0;
  let completionTokens = 0;
  let reply: string | null = null;
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    const json = JSON.parse(trimmed) as { usage?: { input_tokens?: number; output_tokens?: number }; content?: { type?: string; text?: string }[] };
    const text = (json.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
    return { promptTokens: json.usage?.input_tokens ?? 0, completionTokens: json.usage?.output_tokens ?? 0, reply: text || null };
  }
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let event: StreamEvent;
    try {
      event = JSON.parse(line.slice(5).trim()) as StreamEvent;
    } catch {
      continue;
    }
    if (event.type === "message_start") {
      promptTokens = event.message?.usage?.input_tokens ?? promptTokens;
      completionTokens = event.message?.usage?.output_tokens ?? completionTokens;
    } else if (event.type === "message_delta") {
      completionTokens = event.usage?.output_tokens ?? completionTokens;
    } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      reply = (reply ?? "") + (event.delta.text ?? "");
    }
  }
  return { promptTokens, completionTokens, reply };
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
