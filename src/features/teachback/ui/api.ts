/** Calls to the attempts API. Every failure becomes a sentence a person can act on. */
import type { Attempt, IntegritySignals } from "@/shared/types";

export type ApiResult =
  | { ok: true; attempt: Attempt }
  | { ok: false; message: string; status?: number };

/** A little longer than the server's own 120 second limit, so its error arrives first. */
const TIMEOUT_MS = 125_000;

const COULD_NOT_CHECK = "That could not be checked this time. Your text is still here, so you can try again.";
const COULD_NOT_CONNECT =
  "OryxLearn could not be reached. Check your connection, then try again. Your text is still here.";
const TOOK_TOO_LONG = "Checking took too long. Your text is still here, so you can try again.";

/**
 * The API writes its `error` field as a sentence meant for people, so it is safe to show.
 * Anything else, such as a platform error page, gets a built-in sentence instead.
 */
function failureMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : fallback;
}

async function requestAttempt(url: string, init: RequestInit): Promise<ApiResult> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.grade) return { ok: true, attempt: body as Attempt };
    return { ok: false, message: failureMessage(body, COULD_NOT_CHECK), status: response.status };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timedOut ? TOOK_TOO_LONG : COULD_NOT_CONNECT };
  }
}

function postJson(url: string, body: unknown): Promise<ApiResult> {
  return requestAttempt(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function submitExplanation(input: {
  mapId: string;
  nodeId: string;
  explanation: string;
  integrity: IntegritySignals;
}): Promise<ApiResult> {
  return postJson("/api/attempts", input);
}

/** How the answer was given. startedAfterMs is left out when the page doesn't know it. */
export type AnswerDetails = { inputMethod: "typed" | "voice"; startedAfterMs?: number };

export function submitFollowUp(attemptId: string, answer: string, details: AnswerDetails): Promise<ApiResult> {
  return postJson(`/api/attempts/${encodeURIComponent(attemptId)}/followup`, { answer, ...details });
}

/** One attempt as the server has it now, for when a reply went missing. */
export function fetchAttempt(attemptId: string): Promise<ApiResult> {
  return requestAttempt(`/api/attempts/${encodeURIComponent(attemptId)}`, { method: "GET" });
}

/** The attempt that proved this skill, for a panel opened after the fact. */
export async function fetchProvenAttempt(mapId: string, nodeId: string): Promise<ApiResult> {
  const notLoaded = { ok: false, message: "" } as const;
  try {
    const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}/progress`);
    const progress = await response.json();
    const attemptId = progress?.proven?.[nodeId];
    if (typeof attemptId !== "string") return notLoaded;
    return await fetchAttempt(attemptId);
  } catch {
    return notLoaded;
  }
}
