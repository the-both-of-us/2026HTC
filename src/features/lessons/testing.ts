/*
 * Tests only: turn a whole lesson into the JSON lines the model writes, and play them through a
 * mocked `streamLines` exactly as the real one hands them over (each line validated, `onLine`
 * awaited in order). Not exported from the feature's index.
 */
import type { StreamLinesOptions, StreamLinesResult } from "@/features/ai";
import type { RawLesson } from "./prompt";

/** The lines of a lesson, in the order the prompt asks for. */
export function linesOf(raw: RawLesson): object[] {
  return [
    ...raw.idea.map((text) => ({ part: "idea", text })),
    { part: "example", ...raw.example },
    ...raw.mistakes.map((item) => ({ part: "mistake", ...item })),
    ...raw.checks.map((item) => ({ part: "check", ...item })),
    ...(raw.practice ?? []).map((item) => ({ part: "practice", ...item })),
  ];
}

/** A `streamLines` implementation that replies with these lines (or a lesson's lines). */
export function replyWith(reply: RawLesson | object[]) {
  const lines = Array.isArray(reply) ? reply : linesOf(reply);
  return async <L,>(options: StreamLinesOptions<L>): Promise<StreamLinesResult<L>> => {
    const valid: L[] = [];
    const rejected: { index: number; reason: string }[] = [];
    for (const [index, raw] of lines.entries()) {
      const parsed = options.line.safeParse(raw);
      if (!parsed.success) {
        rejected.push({ index, reason: "not a valid line" });
        continue;
      }
      valid.push(parsed.data);
      await options.onLine(parsed.data, valid.length - 1);
    }
    return { lines: valid, rejected, truncated: false };
  };
}

/** The lesson out of a `getOrCreateLesson` reply, failing the test if it is still being written. */
export function lessonIn<T extends object>(reply: T): Extract<T, { lesson: unknown }>["lesson"] {
  if (!("lesson" in reply)) throw new Error(`expected a lesson, got ${JSON.stringify(reply)}`);
  return (reply as { lesson: never }).lesson;
}
