import { z } from "zod";
import { ROUTES, type Route } from "./routes";

const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_TIMEOUT_MS = 30_000;
/** chatJSON only goes round the providers again if they failed faster than this. */
const SECOND_GO_WITHIN_MS = 15_000;

/** Thrown when no provider could answer. The message is safe to show to a user. */
export class AiUnavailableError extends Error {
  constructor() {
    super("The AI is unavailable right now. Please try again in a moment.");
    this.name = "AiUnavailableError";
  }
}

/** One provider failed. The message goes to the server log and never to callers. */
class RouteFailure extends Error {}

export type ChatOptions = {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** Limit for each single request to a provider, not for the whole call. */
  timeoutMs?: number;
  /** A short name for this kind of call, used in the logs. */
  label: string;
};

export type ChatJsonOptions<T> = ChatOptions & { schema: z.ZodType<T> };

/** Asks for plain text. */
export async function chatText(options: ChatOptions): Promise<string> {
  return tryEachRoute(options.label, (route, token) => sendRequest(route, token, options, false));
}

/**
 * Asks for JSON and validates it. The schema's top level must be an object.
 * A bad reply gets one retry on the same provider, with the error appended to
 * the prompt. If that also fails, the next provider gets a turn. If every provider
 * fails quickly, the whole list gets one more go: this model returns an empty reply
 * now and then, and a second try works.
 */
export async function chatJSON<T>(options: ChatJsonOptions<T>): Promise<T> {
  const { schema } = options;
  const system = [options.system, jsonInstructions(schema)].filter(Boolean).join("\n\n");

  const askOneRoute = async (route: Route, token: string): Promise<T> => {
    const firstReply = await sendRequest(route, token, { ...options, system }, true);
    const first = parseReply(firstReply, schema);
    if (first.ok) return first.value;

    const prompt = `${options.prompt}\n\nYour previous reply was rejected: ${first.error}\nReply again with only the corrected JSON.`;
    const secondReply = await sendRequest(route, token, { ...options, system, prompt }, true);
    const second = parseReply(secondReply, schema);
    if (second.ok) return second.value;

    throw new RouteFailure("invalid JSON twice");
  };

  const startedAt = Date.now();
  try {
    return await tryEachRoute(options.label, askOneRoute);
  } catch (error) {
    // A provider that hung will not recover in time, and the learner is waiting.
    if (Date.now() - startedAt > SECOND_GO_WITHIN_MS) throw error;
    return tryEachRoute(options.label, askOneRoute);
  }
}

/** Runs `attempt` on each available provider in order, until one succeeds. */
async function tryEachRoute<T>(
  label: string,
  attempt: (route: Route, token: string) => Promise<T>,
): Promise<T> {
  for (const route of ROUTES) {
    const token = await route.getToken();
    if (!token) continue;

    const startedAt = Date.now();
    try {
      const result = await attempt(route, token);
      console.info(`[ai] ${label}: served by ${route.name} in ${Date.now() - startedAt}ms`);
      return result;
    } catch (error) {
      console.warn(`[ai] ${label}: ${route.name} failed after ${Date.now() - startedAt}ms: ${failureReason(error)}`);
    }
  }

  console.error(`[ai] ${label}: no route could answer`);
  throw new AiUnavailableError();
}

/** Sends one request to one provider and returns the model's reply text. */
async function sendRequest(
  route: Route,
  token: string,
  options: ChatOptions,
  wantJson: boolean,
): Promise<string> {
  const messages = [
    ...(options.system ? [{ role: "system", content: options.system }] : []),
    { role: "user", content: options.prompt },
  ];

  const response = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: route.model,
      messages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(wantJson && route.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new RouteFailure(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new RouteFailure("empty reply");
  }
  return content;
}

/** Anything that is not a RouteFailure is a timeout or a network problem. */
function failureReason(error: unknown): string {
  if (error instanceof RouteFailure) return error.message;
  const isTimeout = error instanceof Error && error.name === "TimeoutError";
  return isTimeout ? "timeout" : "network error";
}

function jsonInstructions(schema: z.ZodType): string {
  // io: "input" describes what the model must send, before any zod transforms.
  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return `Reply with one JSON object and nothing else: no prose and no code fences. It must match this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
}

type ParsedReply<T> = { ok: true; value: T } | { ok: false; error: string };

function parseReply<T>(reply: string, schema: z.ZodType<T>): ParsedReply<T> {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(reply));
  } catch {
    return { ok: false, error: "it was not valid JSON." };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: `it did not match the schema. ${z.prettifyError(result.error)}` };
  }
  return { ok: true, value: result.data };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}
