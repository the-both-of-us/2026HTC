/** Calls to the flashcards API. Every failure becomes a sentence a person can act on. */
import type { Flashcard } from "@/shared/types";

export type SavedResult = { ok: true; items: Flashcard[] | null } | { ok: false; message: string };
export type CreateResult = { ok: true; items: Flashcard[] } | { ok: false; message: string };

/** Reading saved cards is a quick store read. */
const LOAD_TIMEOUT_MS = 15_000;
/**
 * The server stops waiting for the model after 45 seconds and answers with a sentence,
 * inside its own 60 second limit. This is longer than both, so the server's error arrives first.
 */
const CREATE_TIMEOUT_MS = 65_000;

type Messages = { failed: string; timedOut: string };

const LOAD_MESSAGES: Messages = {
  failed: "Your flashcards could not be loaded this time. Please try again.",
  timedOut: "Loading your flashcards took too long. Please try again.",
};
const CREATE_MESSAGES: Messages = {
  failed: "The flashcards could not be made this time. Please try again.",
  timedOut: "Making flashcards took too long. Please try again in a moment.",
};
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";

/**
 * The API writes its `error` field as a sentence meant for people, so it is safe to show.
 * Anything else, such as a platform error page, gets a built-in sentence instead.
 */
function failureMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : fallback;
}

function isCardList(value: unknown): value is Flashcard[] {
  return Array.isArray(value) && value.length > 0;
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  messages: Messages,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json().catch(() => null);
    if (response.ok && body && typeof body === "object" && "items" in body) return { ok: true, body };
    return { ok: false, message: failureMessage(body, messages.failed) };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timedOut ? messages.timedOut : COULD_NOT_CONNECT };
  }
}

/** The saved cards for a skill, or items: null when none have been made. Never generates. */
export async function fetchSavedFlashcards(mapId: string, nodeId: string): Promise<SavedResult> {
  const query = new URLSearchParams({ mapId, nodeId });
  const result = await request(`/api/flashcards?${query}`, { method: "GET" }, LOAD_TIMEOUT_MS, LOAD_MESSAGES);
  if (!result.ok) return result;
  const items = (result.body as { items: unknown }).items;
  if (items === null) return { ok: true, items: null };
  return isCardList(items) ? { ok: true, items } : { ok: false, message: LOAD_MESSAGES.failed };
}

/** Makes the cards with one model call, or returns ones already saved. */
export async function createFlashcards(mapId: string, nodeId: string): Promise<CreateResult> {
  const result = await request(
    "/api/flashcards",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, nodeId }) },
    CREATE_TIMEOUT_MS,
    CREATE_MESSAGES,
  );
  if (!result.ok) return result;
  const items = (result.body as { items: unknown }).items;
  return isCardList(items) ? { ok: true, items } : { ok: false, message: CREATE_MESSAGES.failed };
}
