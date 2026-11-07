/** Calls to the network API. Every failure becomes a sentence a person can act on. */
import type { CleanProfile, MyProfileView, NetworkView } from "../types";

export type Failure = { ok: false; message: string; status: number | null };
export type Result<T> = ({ ok: true } & T) | Failure;

/** Working out everyone's skills reads every map, so allow a little longer than one store read. */
const TIMEOUT_MS = 20_000;
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";

type Messages = { failed: string; timedOut: string };

const LOAD_MESSAGES: Messages = {
  failed: "The network could not be loaded this time. Please try again.",
  timedOut: "Loading the network took too long. Please try again.",
};
const SAVE_MESSAGES: Messages = {
  failed: "Your profile could not be saved this time. Please try again.",
  timedOut: "Saving your profile took too long. Please try again.",
};
const LEAVE_MESSAGES: Messages = {
  failed: "Your profile could not be deleted this time. Please try again.",
  timedOut: "Leaving the network took too long. Please try again.",
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

function isMyProfile(value: unknown): value is MyProfileView {
  return (
    typeof field(value, "publicId") === "string" &&
    typeof field(value, "displayName") === "string" &&
    Array.isArray(field(value, "provenSkills"))
  );
}

function isView(value: unknown): value is NetworkView {
  const me = field(value, "me");
  return (
    (me === null || isMyProfile(me)) &&
    Array.isArray(field(value, "mentors")) &&
    Array.isArray(field(value, "peers")) &&
    Array.isArray(field(value, "everyone")) &&
    typeof field(value, "viewerHasMaps") === "boolean" &&
    typeof field(value, "signInRequired") === "boolean"
  );
}

/** The network as this viewer sees it. */
export function fetchNetwork(): Promise<Result<{ view: NetworkView }>> {
  return request("/api/network", { method: "GET", cache: "no-store" }, LOAD_MESSAGES, (body) =>
    isView(body) ? { view: body } : null,
  );
}

/** Joins the network, or saves changes to your profile. */
export function saveProfile(profile: CleanProfile): Promise<Result<{ me: MyProfileView }>> {
  return request(
    "/api/network",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) },
    SAVE_MESSAGES,
    (body) => {
      const me = field(body, "me");
      return isMyProfile(me) ? { me } : null;
    },
  );
}

/** Leaves the network, which deletes your profile. */
export function leaveNetwork(): Promise<Result<object>> {
  return request("/api/network", { method: "DELETE" }, LEAVE_MESSAGES, (body) =>
    field(body, "ok") === true ? {} : null,
  );
}
