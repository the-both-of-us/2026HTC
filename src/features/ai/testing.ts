/**
 * Helpers for tests, evals and no-cost end-to-end runs that stand in for api.anthropic.com by
 * replacing `globalThis.fetch` (the SDK client looks fetch up on every request). Not imported by
 * app code. Import as `@/features/ai/testing`.
 *
 *   globalThis.fetch = async () => anthropicStreamResponse('{"answer": 42}');
 */

/** Anything the request body says, for a stub that wants to read the prompt. */
export type AnthropicRequestBody = {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages?: { role: string; content: string }[];
  thinking?: { type: string };
  output_config?: { effort?: string };
};

/** Reads the JSON body of a request made through the SDK (`fetch(url, init)`). */
export function readAnthropicRequest(init: RequestInit | undefined): AnthropicRequestBody {
  return typeof init?.body === "string" ? (JSON.parse(init.body) as AnthropicRequestBody) : {};
}

/**
 * A `POST /v1/messages` streaming response that says `text` (a string, or chunks sent as separate
 * deltas) and stops with `stopReason`.
 */
export function anthropicStreamResponse(
  text: string | string[],
  { stopReason = "end_turn", model = "claude-haiku-5-5" }: { stopReason?: string; model?: string } = {},
): Response {
  const chunks = Array.isArray(text) ? text : [text];
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    ],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ...chunks.map((chunk): [string, unknown] => [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } },
    ]),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** An error response in the API's own shape, e.g. `anthropicError(429)`. */
export function anthropicError(status: number, headers: Record<string, string> = {}): Response {
  return Response.json({ type: "error", error: { type: "api_error", message: "stub" } }, { status, headers });
}
