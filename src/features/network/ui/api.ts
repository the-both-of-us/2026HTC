/** Calls to the network API. Every failure becomes a sentence a person can act on. */
import type { CleanProfile, InviteView, MyProfileView, NetworkView, PrivacySettings } from "../types";

export type Failure = { ok: false; message: string; status: number | null };
export type Result<T> = ({ ok: true } & T) | Failure;

/** Working out everyone's skills reads every map, so allow a little longer than one store read. */
const TIMEOUT_MS = 20_000;
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";

type Messages = { failed: string; timedOut: string };

const JSON_HEADERS = { "Content-Type": "application/json" };

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
  timedOut: "Deleting your profile took too long. Please try again.",
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
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok)
      return {
        ok: false,
        message: failureMessage(body, messages.failed),
        status: response.status,
      };
    const value = read(body);
    return value ? { ok: true, ...value } : { ok: false, message: messages.failed, status: response.status };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut ? messages.timedOut : COULD_NOT_CONNECT,
      status: null,
    };
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
    typeof field(value, "inNetwork") === "boolean" &&
    Array.isArray(field(value, "friends")) &&
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
export function saveProfile(profile: CleanProfile, inNetwork?: boolean): Promise<Result<{ me: MyProfileView }>> {
  return request(
    "/api/network",
    {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...profile, inNetwork }),
    },
    SAVE_MESSAGES,
    (body) => {
      const me = field(body, "me");
      return isMyProfile(me) ? { me } : null;
    },
  );
}

/** Deletes your profile, your friend links and your invite link. */
export function deleteProfile(): Promise<Result<object>> {
  return request("/api/network", { method: "DELETE" }, LEAVE_MESSAGES, (body) =>
    field(body, "ok") === true ? {} : null,
  );
}

/** Opts in to the network, or out of it. */
export function setInNetwork(inNetwork: boolean): Promise<Result<object>> {
  return request(
    "/api/network",
    {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ inNetwork }),
    },
    {
      failed: "Your network setting could not be saved this time. Please try again.",
      timedOut: "Saving your network setting took too long. Please try again.",
    },
    (body) => (field(body, "me") !== undefined ? {} : null),
  );
}

/** Your invite code: the same each time, or a new one with `fresh`, which retires the old link. */
export function createInvite(fresh = false): Promise<Result<{ code: string }>> {
  return request(
    "/api/network/invite",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ fresh }) },
    {
      failed: "The invite link could not be made this time. Please try again.",
      timedOut: "Making the invite link took too long. Please try again.",
    },
    (body) => {
      const code = field(body, "code");
      return typeof code === "string" ? { code } : null;
    },
  );
}

/** Who sent an invite. */
export function fetchInvite(code: string): Promise<Result<{ invite: InviteView }>> {
  return request(
    `/api/network/invite/${encodeURIComponent(code)}`,
    { method: "GET", cache: "no-store" },
    {
      failed: "This invite could not be loaded. Please try again.",
      timedOut: "Loading the invite took too long. Please try again.",
    },
    (body) =>
      field(body, "inviter") && typeof field(body, "isYou") === "boolean" ? { invite: body as InviteView } : null,
  );
}

/** Accepts an invite, with a name for a viewer who has no profile yet. */
export function acceptInvite(code: string, displayName: string | null): Promise<Result<{ friend: string }>> {
  return request(
    `/api/network/invite/${encodeURIComponent(code)}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ displayName }),
    },
    {
      failed: "You could not be added as friends this time. Please try again.",
      timedOut: "Adding your friend took too long. Please try again.",
    },
    (body) => {
      const friend = field(body, "friend");
      return typeof friend === "string" ? { friend } : null;
    },
  );
}

/** Removes a friend, both ways. */
export function removeFriend(publicId: string): Promise<Result<object>> {
  return request(
    `/api/network/friends/${encodeURIComponent(publicId)}`,
    { method: "DELETE" },
    {
      failed: "Your friend could not be removed this time. Please try again.",
      timedOut: "Removing your friend took too long. Please try again.",
    },
    (body) => (field(body, "ok") === true ? {} : null),
  );
}

const okBody = (body: unknown) => (field(body, "ok") === true ? {} : null);

/** Sends a friend request, or accepts theirs if they already asked. */
export function sendFriendRequest(publicId: string): Promise<Result<{ status: "sent" | "friends" }>> {
  return request(
    "/api/network/requests",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ publicId }) },
    {
      failed: "Your friend request could not be sent this time. Please try again.",
      timedOut: "Sending your friend request took too long. Please try again.",
    },
    (body) => {
      const status = field(body, "status");
      return status === "sent" || status === "friends" ? { status } : null;
    },
  );
}

/** Accepts a friend request. */
export function acceptFriendRequest(publicId: string): Promise<Result<object>> {
  return request(
    `/api/network/requests/${encodeURIComponent(publicId)}/accept`,
    { method: "POST" },
    {
      failed: "The friend request could not be accepted this time. Please try again.",
      timedOut: "Accepting the friend request took too long. Please try again.",
    },
    (body) => (typeof field(body, "friend") === "string" ? {} : null),
  );
}

/** Declines a request to you, or cancels yours. */
export function removeFriendRequest(publicId: string): Promise<Result<object>> {
  return request(
    `/api/network/requests/${encodeURIComponent(publicId)}`,
    { method: "DELETE" },
    {
      failed: "The friend request could not be removed this time. Please try again.",
      timedOut: "Removing the friend request took too long. Please try again.",
    },
    okBody,
  );
}

/** Pings a friend. */
export function pingFriend(publicId: string): Promise<Result<object>> {
  return request(
    "/api/network/pings",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ publicId }) },
    {
      failed: "Your ping could not be sent this time. Please try again.",
      timedOut: "Sending your ping took too long. Please try again.",
    },
    okBody,
  );
}

/** Dismisses a ping. */
export function dismissPing(publicId: string): Promise<Result<object>> {
  return request(
    `/api/network/pings/${encodeURIComponent(publicId)}`,
    { method: "DELETE" },
    {
      failed: "The ping could not be dismissed this time. Please try again.",
      timedOut: "Dismissing the ping took too long. Please try again.",
    },
    okBody,
  );
}

/** Saves one of the friends and privacy settings. */
export function savePrivacy(settings: Partial<PrivacySettings>): Promise<Result<{ me: MyProfileView }>> {
  return request(
    "/api/network",
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(settings) },
    {
      failed: "Your setting could not be saved this time. Please try again.",
      timedOut: "Saving your setting took too long. Please try again.",
    },
    (body) => {
      const me = field(body, "me");
      return isMyProfile(me) ? { me } : null;
    },
  );
}
