/** The call to the lessons API. Every failure becomes a sentence a person can act on. */
import type { Lesson } from "../types";

export type LessonResult = { ok: true; lesson: Lesson } | { ok: false; message: string };

/** The server gives up on the model after 50 seconds, inside its 60. This is longer, so its sentence arrives first. */
const TIMEOUT_MS = 65_000;
const FAILED = "The lesson could not be loaded this time. Please try again.";

/** The saved lesson, or one written now with one model call. */
export async function fetchLesson(mapId: string, nodeId: string): Promise<LessonResult> {
  try {
    const response = await fetch("/api/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && Array.isArray(body?.lesson?.idea)) return { ok: true, lesson: body.lesson };
    // The API's `error` is written for people. A platform error page gets our own sentence.
    return { ok: false, message: typeof body?.error === "string" ? body.error : FAILED };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut
        ? "Writing the lesson took too long. Please try again in a moment."
        : "OryxLearn could not be reached. Check your connection, then try again.",
    };
  }
}
