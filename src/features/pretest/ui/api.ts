import type { PretestAnswersRequest, PretestView } from "../types";

/*
 * Calls to /api/pretest/[mapId]. Every failure becomes a sentence a person can act on. The server
 * writes its `error` field for people, so it is shown as is; anything else gets a built-in one.
 */

export type PretestResult = { ok: true; view: PretestView } | { ok: false; status: number; message: string };

const TIMEOUT_MS = 60_000;
const NETWORK = "OryxLearn could not be reached. Check your connection, then try again.";
const FAILED = "That did not work this time. Please try again.";
const CHECK_FAILED = "Your answers could not be checked this time. Nothing was recorded, so send them again.";

function url(mapId: string, tail = ""): string {
  return `/api/pretest/${encodeURIComponent(mapId)}${tail}`;
}

async function request(mapId: string, tail: string, init: RequestInit, signal?: AbortSignal): Promise<PretestResult> {
  try {
    const response = await fetch(url(mapId, tail), {
      cache: "no-store",
      ...init,
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as (Partial<PretestView> & { error?: unknown }) | null;
    if (response.ok && body && typeof body.offer === "string" && typeof body.state === "string") {
      return { ok: true, view: body as PretestView };
    }
    const fallback = response.status === 503 ? CHECK_FAILED : FAILED;
    return { ok: false, status: response.status, message: typeof body?.error === "string" ? body.error : fallback };
  } catch {
    return { ok: false, status: 0, message: NETWORK };
  }
}

function post(mapId: string, tail: string, body?: unknown): Promise<PretestResult> {
  return request(mapId, tail, {
    method: "POST",
    ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

export const getPretest = (mapId: string, signal?: AbortSignal) => request(mapId, "", { method: "GET" }, signal);
export const startPretest = (mapId: string) => post(mapId, "/start");
export const stopPretest = (mapId: string) => post(mapId, "/stop");
export const dismissPretest = (mapId: string) => post(mapId, "/dismiss");
export const submitPretestAnswers = (mapId: string, body: PretestAnswersRequest) => post(mapId, "/answers", body);
