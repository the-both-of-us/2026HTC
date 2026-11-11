import { z } from "zod";
import { runCall } from "./call";
import { AiUnavailableError } from "./errors";
import { PROFILES, type Profile } from "./profiles";

export { AiRefusedError, AiUnavailableError } from "./errors";

/** A repair needs at least this much of the call's time left, or it is not started. */
const MIN_REPAIR_BUDGET_MS = 5_000;

export type ChatOptions = {
  /** Which thinking profile the call uses (see profiles.ts). Callers pass this, never a model. */
  profile: Profile;
  /** Limit for the whole call, repair included. At most the profile's totalMs. */
  totalMs?: number;
  system?: string;
  prompt: string;
  /** At most the profile's maxTokens (thinking counts against it). */
  maxTokens?: number;
  /** A short name for this kind of call, used in the logs. */
  label: string;
  /** Called once with the model that answered and how long the whole call took. */
  onServed?: (servedBy: ServedBy) => void;
};

/** Which model answered, and how long the whole call took, for "Written by Claude Haiku in 12 s". */
export type ServedBy = { route: "anthropic"; model: string; ms: number };

export type ChatJsonOptions<T> = ChatOptions & { schema: z.ZodType<T> };

/** Asks for plain text. */
export async function chatText(options: ChatOptions): Promise<string> {
  const startedAt = Date.now();
  const result = await runCall(spec(options));
  if (result.stopReason === "max_tokens") {
    console.warn(`[ai] ${options.label}: cut off at max_tokens`);
    throw new AiUnavailableError();
  }
  if (result.text.trim() === "") {
    console.warn(`[ai] ${options.label}: empty reply`);
    throw new AiUnavailableError();
  }
  options.onServed?.({ route: "anthropic", model: result.model, ms: Date.now() - startedAt });
  return result.text;
}

/**
 * Asks for JSON and validates it. The schema's top level must be an object.
 * A bad reply gets one repair request, with the error appended to the prompt, if the call has
 * time left. A reply cut off at max_tokens is a failure, not a repair: it would be cut off again.
 */
export async function chatJSON<T>(options: ChatJsonOptions<T>): Promise<T> {
  const { schema } = options;
  const system = [options.system, jsonInstructions(schema)].filter(Boolean).join("\n\n");
  const totalMs = Math.min(options.totalMs ?? Infinity, PROFILES[options.profile].totalMs);
  const startedAt = Date.now();

  const ask = async (prompt: string, budgetMs: number) => {
    const result = await runCall({ ...spec(options), system, prompt, totalMs: budgetMs });
    if (result.stopReason === "max_tokens") {
      console.warn(`[ai] ${options.label}: cut off at max_tokens`);
      throw new AiUnavailableError();
    }
    return { ...result, parsed: parseReply(result.text, schema) };
  };

  const first = await ask(options.prompt, totalMs);
  let served = first;
  let value = first.parsed.ok ? first.parsed.value : undefined;

  if (!first.parsed.ok) {
    const remaining = totalMs - (Date.now() - startedAt);
    console.warn(`[ai] ${options.label}: reply rejected (${first.parsed.error.split("\n")[0]})`);
    if (remaining < MIN_REPAIR_BUDGET_MS) throw new AiUnavailableError();
    const prompt = `${options.prompt}\n\nYour previous reply was rejected: ${first.parsed.error}\nReply again with only the corrected JSON.`;
    const second = await ask(prompt, remaining);
    if (!second.parsed.ok) {
      console.warn(`[ai] ${options.label}: invalid JSON twice`);
      throw new AiUnavailableError();
    }
    served = second;
    value = second.parsed.value;
  }

  options.onServed?.({ route: "anthropic", model: served.model, ms: Date.now() - startedAt });
  return value as T;
}

function spec(options: ChatOptions) {
  return {
    profile: options.profile,
    label: options.label,
    system: options.system,
    prompt: options.prompt,
    maxTokens: options.maxTokens,
    totalMs: options.totalMs,
  } as const;
}

function jsonInstructions(schema: z.ZodType): string {
  // io: "input" describes what the model must send, before any zod transforms.
  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return `Reply with one JSON object and nothing else: no prose and no code fences. It must match this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
}

type ParsedReply<T> = { ok: true; value: T } | { ok: false; error: string };

function parseReply<T>(reply: string, schema: z.ZodType<T>): ParsedReply<T> {
  const json = parseJson(reply);
  if (json === undefined) return { ok: false, error: "it was not valid JSON." };

  const result = schema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: `it did not match the schema. ${z.prettifyError(result.error)}` };
  }
  return { ok: true, value: result.data };
}

/** JSON as sent, or inside a code fence, or the outermost {...} when the model added a sentence around it. */
function parseJson(reply: string): unknown {
  const trimmed = reply.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidates = [fenced ? fenced[1] : trimmed];
  const open = trimmed.indexOf("{");
  const close = trimmed.lastIndexOf("}");
  if (open !== -1 && close > open) candidates.push(trimmed.slice(open, close + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next one
    }
  }
  return undefined;
}
