import { z } from "zod";
import { runCall, type CallSpec } from "./call";
import { AiUnavailableError } from "./errors";
import type { Profile } from "./profiles";

/** Appended to the system prompt of every lines call, so callers need not. */
export const JSON_LINES_INSTRUCTION = "Reply with JSON Lines: one JSON object per line, no prose, no code fences.";

export type StreamLinesOptions<L> = {
  profile: Profile;
  /** A short name for this kind of call, used in the logs. */
  label: string;
  system: string;
  prompt: string;
  /** Validates each line; usually a discriminated union on `kind` or `part`. */
  line: z.ZodType<L>;
  /** At most the profile's maxTokens. */
  maxTokens?: number;
  /** At most the profile's firstTextMs. */
  firstTextMs?: number;
  /** At most the profile's totalMs. */
  totalMs?: number;
  /** At most the profile's effort. */
  effort?: CallSpec["effort"];
  /**
   * Called once per valid line, in order, and awaited before the next one, so it can write to
   * the store (`emit`). `index` is the line's position among the valid lines (`lines[index]`).
   * An error it throws aborts the stream and rejects streamLines with that error.
   */
  onLine: (line: L, index: number) => void | Promise<void>;
};

export type StreamLinesResult<L> = {
  /** Every valid line, in order. */
  lines: L[];
  /** Lines that were not JSON or failed `line`. They never throw; the caller decides on a repair. `index` counts non-blank lines. */
  rejected: { index: number; reason: string }[];
  /** True when the reply stopped at max_tokens. The lines so far are still returned. */
  truncated: boolean;
};

/**
 * Streams a reply and hands over each complete JSON line as it arrives. Splits text deltas on
 * "\n", skips blank lines and code fences, parses and validates each line, and handles a last
 * line with no newline at the end. Throws AiUnavailableError when the call fails (after the
 * one fast retry), AiRefusedError on a refusal. A timeout after some lines throws too; the
 * lines already handed to `onLine` stand.
 */
export async function streamLines<L>(options: StreamLinesOptions<L>): Promise<StreamLinesResult<L>> {
  const lines: L[] = [];
  const rejected: StreamLinesResult<L>["rejected"] = [];
  let buffer = "";
  let nonBlank = 0;
  let cutOff = false;

  const handle = async (raw: string) => {
    const text = raw.trim();
    if (text === "" || text.startsWith("```")) return;
    const values = parseJsonLine(text);
    if (values === null) {
      rejected.push({ index: nonBlank++, reason: cutOff ? "cut off at max_tokens" : "not valid JSON" });
      return;
    }
    for (const json of values) {
      const index = nonBlank++;
      const parsed = options.line.safeParse(json);
      if (!parsed.success) {
        rejected.push({ index, reason: z.prettifyError(parsed.error) });
        continue;
      }
      lines.push(parsed.data);
      await options.onLine(parsed.data, lines.length - 1);
    }
  };

  const result = await runCall(
    {
      profile: options.profile,
      label: options.label,
      system: [options.system, JSON_LINES_INSTRUCTION].join("\n\n"),
      prompt: options.prompt,
      maxTokens: options.maxTokens,
      firstTextMs: options.firstTextMs,
      totalMs: options.totalMs,
      effort: options.effort,
    },
    async (delta) => {
      buffer += delta;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) await handle(part);
    },
  );

  cutOff = result.stopReason === "max_tokens";
  await handle(buffer);
  if (result.text.trim() === "") {
    console.warn(`[ai] ${options.label}: empty reply`);
    throw new AiUnavailableError();
  }
  console.info(`[ai] ${options.label}: ${lines.length} lines, ${rejected.length} rejected${cutOff ? ", truncated" : ""}`);
  return { lines, rejected, truncated: cutOff };
}

/** What may sit between two objects on one line: spaces, commas, array brackets, or a written-out "\\n". */
const BETWEEN_OBJECTS = /^(?:\s|,|\[|\]|\\n)*$/;

/**
 * The JSON values on one line of a reply, or null when it is not JSON. Besides a plain object
 * line it accepts the slips Haiku makes (measured Nov 2026): a trailing comma as if the lines were
 * an array ("{...},"), array brackets, several objects on one line separated by spaces, commas or
 * a written-out "\n", and an object closed by a written-out "\n" with its "}" left out. Each
 * object must still be valid JSON on its own, and the caller still validates it.
 */
export function parseJsonLine(text: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(text);
    // A whole reply written as one JSON array on one line: its items are the lines.
    return Array.isArray(value) ? value : [value];
  } catch {
    // Fall through to the tolerant reading below.
  }
  const objects: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let gapStart = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      if (depth === 0) return null;
      inString = true;
    } else if (depth === 1 && text.startsWith("\\n{", i)) {
      // `..."\n{"part":...`: the model ended the object with a written-out "\n" and forgot its "}".
      // A backslash outside a string is never valid JSON, so this cannot change a good line.
      objects.push(`${text.slice(start, i)}}`);
      depth = 0;
      gapStart = i;
    } else if (char === "{") {
      if (depth === 0) {
        if (!BETWEEN_OBJECTS.test(text.slice(gapStart, i))) return null;
        start = i;
      }
      depth++;
    } else if (char === "}") {
      if (depth === 0) return null;
      depth--;
      if (depth === 0) {
        objects.push(text.slice(start, i + 1));
        gapStart = i + 1;
      }
    }
  }
  if (depth !== 0 || objects.length === 0 || !BETWEEN_OBJECTS.test(text.slice(gapStart))) return null;
  try {
    return objects.map((object) => JSON.parse(object) as unknown);
  } catch {
    return null;
  }
}
