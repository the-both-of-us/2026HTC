/** Calls to the quiz API. Every failure becomes a sentence a person can act on. */
import type { QuizQuestion } from "@/shared/types";

export type QuizResult = { ok: true; items: QuizQuestion[] | null } | { ok: false; message: string };

/** Reading a saved quiz is a store read, so it should be quick. */
const LOAD_TIMEOUT_MS = 20_000;
/** A little longer than the server's own 60 second limit, so its error arrives first. */
const CREATE_TIMEOUT_MS = 65_000;

const COULD_NOT_LOAD = "The quiz could not be loaded this time. Please try again.";
const COULD_NOT_MAKE = "The quiz could not be made this time. Please try again in a minute.";
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";
const TOOK_TOO_LONG = "That took too long. Please try again in a minute.";

/**
 * The API writes its `error` field as a sentence meant for people, so it is safe to show.
 * Anything else, such as a platform error page, gets a built-in sentence instead.
 */
function failureMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : fallback;
}

async function requestQuiz(url: string, init: RequestInit, timeoutMs: number, fallback: string): Promise<QuizResult> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => null);
    const items = (body as { items?: unknown } | null)?.items;
    if (response.ok && (items === null || Array.isArray(items))) {
      return { ok: true, items: items as QuizQuestion[] | null };
    }
    return { ok: false, message: failureMessage(body, fallback) };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timedOut ? TOOK_TOO_LONG : COULD_NOT_CONNECT };
  }
}

/** The saved quiz, or `items: null` when none exists yet. Never makes one. */
export function fetchSavedQuiz(mapId: string, nodeId: string): Promise<QuizResult> {
  const query = new URLSearchParams({ mapId, nodeId });
  return requestQuiz(`/api/quiz?${query}`, { method: "GET" }, LOAD_TIMEOUT_MS, COULD_NOT_LOAD);
}

/** Makes the quiz, or returns the one already saved. This can cost a model call. */
export function createQuiz(mapId: string, nodeId: string): Promise<QuizResult> {
  return requestQuiz(
    "/api/quiz",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId }),
    },
    CREATE_TIMEOUT_MS,
    COULD_NOT_MAKE,
  );
}
