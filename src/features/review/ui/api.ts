/** Calls to the review API. Every failure becomes a sentence a person can act on. */
import { GRADES, type Grade, type QueueItem, type ReviewQueue, type ScheduleResult } from "../types";

export type Failure = { ok: false; message: string; status: number | null };
export type Result<T> = ({ ok: true } & T) | Failure;

/** A queue is a few store reads per map; a grade is a few more. */
const TIMEOUT_MS = 15_000;
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";

type Messages = { failed: string; timedOut: string };

const QUEUE_MESSAGES: Messages = {
  failed: "Your review cards could not be loaded this time. Please try again.",
  timedOut: "Loading your review cards took too long. Please try again.",
};
/** The screen puts "Your answer was not saved, so this card is back on screen." in front of these. */
const GRADE_MESSAGES: Messages = {
  failed: "Please answer it again.",
  timedOut: "Saving took too long. Please answer it again.",
};

/**
 * The API writes its `error` field as a sentence meant for people, so it is safe to show.
 * Anything else, such as a platform error page, gets a built-in sentence instead.
 */
function failureMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}

async function request<T>(
  url: string,
  init: RequestInit,
  messages: Messages,
  read: (body: unknown) => T | null,
): Promise<Result<T>> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, message: failureMessage(body, messages.failed), status: response.status };
    const value = read(body);
    return value ? { ok: true, ...value } : { ok: false, message: messages.failed, status: response.status };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timedOut ? messages.timedOut : COULD_NOT_CONNECT, status: null };
  }
}

function field(body: unknown, name: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
}

function isItem(value: unknown): value is QueueItem {
  const intervals = field(value, "intervals");
  return (
    ["cardId", "mapId", "nodeId", "front", "back", "mapTitle", "skillTitle"].every(
      (name) => typeof field(value, name) === "string",
    ) &&
    typeof field(value, "isNew") === "boolean" &&
    GRADES.every((grade) => typeof field(intervals, grade) === "number")
  );
}

/** Reads a queue body, or null if it is not one. Exported for tests. */
export function readQueue(body: unknown): { queue: ReviewQueue } | null {
  const queue = field(body, "queue");
  const nextDueAt = field(body, "nextDueAt");
  const ok =
    Array.isArray(queue) &&
    queue.every(isItem) &&
    ["dueCount", "newCount", "moreNew", "totalCards"].every((name) => typeof field(body, name) === "number") &&
    (nextDueAt === null || typeof nextDueAt === "string");
  return ok ? { queue: body as ReviewQueue } : null;
}

/** Your queue: due reviews first, then new cards. */
export function fetchQueue(): Promise<Result<{ queue: ReviewQueue }>> {
  return request("/api/review", { method: "GET", cache: "no-store" }, QUEUE_MESSAGES, readQueue);
}

/** Saves one answer and returns when the card comes back. */
export function sendGrade(item: QueueItem, grade: Grade): Promise<Result<{ schedule: ScheduleResult }>> {
  return request(
    "/api/review",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId: item.mapId, nodeId: item.nodeId, cardId: item.cardId, grade }),
    },
    GRADE_MESSAGES,
    (body) => {
      const dueAt = field(body, "dueAt");
      const intervalDays = field(body, "intervalDays");
      return typeof dueAt === "string" && typeof intervalDays === "number"
        ? { schedule: { dueAt, intervalDays } }
        : null;
    },
  );
}
