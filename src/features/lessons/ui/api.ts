/** The calls to the lessons API. Every failure becomes a sentence a person can act on. */
import type { Lesson, LessonPart, PracticeFeedback, PracticeHint } from "../types";

/** One step of a lesson being read: the final lesson, the parts written so far, or a failure. */
export type LessonStep =
  | { kind: "lesson"; lesson: Lesson }
  | { kind: "writing"; attempt: number; parts: LessonPart[] }
  | { kind: "error"; message: string };

/** Each POST answers at once (the writer runs on the server), so a short limit is enough. */
const TIMEOUT_MS = 40_000;
const FAILED = "The lesson could not be loaded this time. Please try again.";

/**
 * Defence in depth: the server never sends a model answer, but a practice part is rebuilt here
 * from its two public fields so nothing else could ever reach the page.
 */
export function publicParts(value: unknown): LessonPart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): LessonPart[] => {
    const part = raw as Record<string, unknown> | null;
    if (!part || typeof part !== "object") return [];
    const text = (key: string) => (typeof part[key] === "string" ? (part[key] as string) : null);
    switch (part.part) {
      case "idea": {
        const t = text("text");
        return t === null ? [] : [{ part: "idea", text: t }];
      }
      case "example": {
        const intro = text("intro");
        const after = text("after");
        if (intro === null || after === null) return [];
        return [{ part: "example", intro, code: text("code"), after }];
      }
      case "mistake": {
        const mistake = text("mistake");
        const fix = text("fix");
        return mistake === null || fix === null ? [] : [{ part: "mistake", mistake, fix }];
      }
      case "check": {
        const question = text("question");
        const answer = text("answer");
        return question === null || answer === null ? [] : [{ part: "check", question, answer }];
      }
      case "practice": {
        const scenario = text("scenario");
        const question = text("question");
        return scenario === null || question === null ? [] : [{ part: "practice", scenario, question }];
      }
      default:
        return [];
    }
  });
}

/**
 * `POST /api/lessons`. Starts the writer if nobody is writing, and answers `{ lesson }` once the
 * lesson is final, or `{ status: "writing", attempt, parts }` while it is being written.
 */
export async function fetchLessonStep(mapId: string, nodeId: string, signal?: AbortSignal): Promise<LessonStep> {
  try {
    const response = await fetch("/api/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && Array.isArray(body?.lesson?.idea)) return { kind: "lesson", lesson: body.lesson };
    if (response.ok && body?.status === "writing") {
      return { kind: "writing", attempt: typeof body.attempt === "number" ? body.attempt : 1, parts: publicParts(body.parts) };
    }
    // The API's `error` is written for people. A platform error page gets our own sentence.
    return { kind: "error", message: typeof body?.error === "string" ? body.error : FAILED };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      kind: "error",
      message: timedOut
        ? "Writing the lesson took too long. Please try again in a moment."
        : "OryxLearn could not be reached. Check your connection, then try again.",
    };
  }
}

export type PracticeResult = { ok: true; feedback: PracticeFeedback } | { ok: false; message: string };

/** Checks an answer to practice case `caseIndex`. The model answer stays on the server: only a verdict and a note come back. */
export async function checkPractice(mapId: string, nodeId: string, caseIndex: number, answer: string): Promise<PracticeResult> {
  try {
    const response = await fetch("/api/lessons/practice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId, caseIndex, answer }),
      signal: AbortSignal.timeout(40_000),
    });
    const body = await response.json().catch(() => null);
    const feedback = body?.feedback;
    if (response.ok && typeof feedback?.verdict === "string" && typeof feedback?.feedback === "string") {
      return { ok: true, feedback };
    }
    return { ok: false, message: typeof body?.error === "string" ? body.error : "Your answer could not be checked this time. Please try again." };
  } catch {
    return { ok: false, message: "Your answer could not be checked. Check your connection, then try again." };
  }
}

export type PracticeHintResult = { ok: true; hint: PracticeHint } | { ok: false; message: string };

/**
 * The next step of help on practice case `caseIndex`: hint 1, 2 or 3 (written for what the learner
 * has typed so far), or step 4, the model answer.
 */
export async function fetchPracticeHint(mapId: string, nodeId: string, caseIndex: number, step: number, answer: string): Promise<PracticeHintResult> {
  try {
    const response = await fetch("/api/lessons/practice/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId, caseIndex, step, answer: answer.slice(0, 4_000) }),
      signal: AbortSignal.timeout(40_000),
    });
    const body = await response.json().catch(() => null);
    const hint = body?.hint;
    if (response.ok && typeof hint?.text === "string" && (hint.kind === "hint" || hint.kind === "answer") && typeof hint.step === "number") {
      return { ok: true, hint: { step: hint.step, kind: hint.kind, text: hint.text } };
    }
    return { ok: false, message: typeof body?.error === "string" ? body.error : "We could not get a hint this time. Please try again." };
  } catch {
    return { ok: false, message: "We could not get a hint. Check your connection, then try again." };
  }
}
