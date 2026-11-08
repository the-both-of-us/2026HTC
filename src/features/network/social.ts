/**
 * Friend requests from the network, pings between friends, friends' courses, and the
 * privacy settings that govern them.
 *
 * Keys:
 * - `network/requests/<toUserId>/<fromUserId>`: `{since}`, a request waiting for an answer.
 * - `network/pings/<toUserId>/<fromUserId>`: `{at}`, the latest ping, until it is dismissed.
 * - `network/ping-sent/<fromUserId>/<toUserId>`: `{at}`, so a dismissed ping still counts
 *   towards the once-an-hour limit.
 */
import { deriveNodeStates, listMapsByOwner } from "@/features/skill-map";
import { getProgress } from "@/features/teachback";
import { deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";
import { NetworkError } from "./errors";
import { addFriendship, areFriends } from "./friends";
import { getProfile, isInNetwork, listProfiles, profileKey } from "./profiles";
import { assertUserId, isUserId, requireJoiner } from "./session";
import type { FriendCourse, FriendRequestView, PingView, PrivacySettings, ProfileRecord } from "./types";

const REQUESTS = "network/requests/";
const PINGS = "network/pings/";
const PING_SENT = "network/ping-sent/";
export const PING_INTERVAL_MS = 60 * 60 * 1000;
export const MAX_FRIEND_COURSES = 6;

type RequestRecord = { since: string };
type PingRecord = { at: string };

const requestKey = (to: string, from: string) => `${REQUESTS}${to}/${from}`;
const pingKey = (to: string, from: string) => `${PINGS}${to}/${from}`;
const pingSentKey = (from: string, to: string) => `${PING_SENT}${from}/${to}`;

const MAKE_PROFILE_FIRST = "Make your profile first, so people know who you are.";
const NOT_FOUND = "We could not find that person. They may have left the network.";

/** Missing means on: every setting defaults to true. */
export function privacyOf(record: ProfileRecord | null): PrivacySettings {
  return {
    shareProgress: record?.shareProgress !== false,
    allowRequests: record?.allowRequests !== false,
    allowPings: record?.allowPings !== false,
  };
}

/** Saves any of the three settings. Needs a profile. Returns the updated record. */
export async function setPrivacy(userId: string, settings: Partial<PrivacySettings>): Promise<ProfileRecord> {
  assertUserId(userId);
  const existing = await getProfile(userId);
  if (!existing || existing.isDemo) throw new NetworkError(MAKE_PROFILE_FIRST, 400);
  const record: ProfileRecord = { ...existing, updatedAt: new Date().toISOString() };
  for (const name of ["shareProgress", "allowRequests", "allowPings"] as const) {
    if (typeof settings[name] === "boolean") record[name] = settings[name];
  }
  await putDoc(profileKey(userId), record);
  return record;
}

async function ownProfile(userId: string): Promise<ProfileRecord> {
  await requireJoiner(userId);
  const mine = await getProfile(userId);
  if (!mine || mine.isDemo) throw new NetworkError(MAKE_PROFILE_FIRST, 400);
  return mine;
}

async function findByPublicId(publicId: string): Promise<ProfileRecord | null> {
  const profiles = await listProfiles();
  return profiles.find((record) => record.publicId === publicId && !record.isDemo && isUserId(record.userId)) ?? null;
}

/** Ids of the people who sent `userId` a request. */
async function incomingIds(userId: string): Promise<string[]> {
  const prefix = `${REQUESTS}${userId}/`;
  return (await listKeys(prefix)).map((key) => key.slice(prefix.length)).filter(isUserId);
}

/** True when `from` has asked `to` and is waiting. */
export async function hasRequest(to: string, from: string): Promise<boolean> {
  return (await getDoc<RequestRecord>(requestKey(to, from))) !== null;
}

async function befriend(a: string, b: string): Promise<void> {
  await addFriendship(a, b);
  await Promise.all([deleteDoc(requestKey(a, b)), deleteDoc(requestKey(b, a))]);
}

/**
 * Sends a friend request to someone in the network. If they already asked you, you become
 * friends at once. Both people need a profile; the receiver must be in the network and allow requests.
 */
export async function sendFriendRequest(userId: string, publicId: string): Promise<{ status: "sent" | "friends" }> {
  await ownProfile(userId);
  const target = await findByPublicId(publicId);
  if (!target || target.userId === userId || !isInNetwork(target)) throw new NetworkError(NOT_FOUND, 404);
  if (await areFriends(userId, target.userId)) return { status: "friends" };
  if (await hasRequest(userId, target.userId)) {
    await befriend(userId, target.userId);
    return { status: "friends" };
  }
  if (!privacyOf(target).allowRequests) {
    throw new NetworkError(`${target.displayName} isn't taking friend requests right now.`, 403);
  }
  await putDoc(requestKey(target.userId, userId), { since: new Date().toISOString() } satisfies RequestRecord);
  return { status: "sent" };
}

/** Accepts a request someone sent you. */
export async function acceptFriendRequest(userId: string, publicId: string): Promise<{ friend: string }> {
  await ownProfile(userId);
  const sender = await findByPublicId(publicId);
  if (!sender || !(await hasRequest(userId, sender.userId))) {
    throw new NetworkError("That friend request is no longer there.", 404);
  }
  await befriend(userId, sender.userId);
  return { friend: sender.displayName };
}

/** Declines a request to you, or cancels yours to them. Twice is fine, and needs no sign-in. */
export async function removeFriendRequest(userId: string, publicId: string): Promise<void> {
  assertUserId(userId);
  const other = await findByPublicId(publicId);
  if (!other) return;
  await Promise.all([deleteDoc(requestKey(userId, other.userId)), deleteDoc(requestKey(other.userId, userId))]);
}

/** Requests waiting for this viewer, newest first. */
export async function listFriendRequests(userId: string): Promise<FriendRequestView[]> {
  const ids = await incomingIds(userId);
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [profile, record] = await Promise.all([getProfile(id), getDoc<RequestRecord>(requestKey(userId, id))]);
      if (!profile || profile.isDemo || !record) return null;
      return { publicId: profile.publicId, displayName: profile.displayName, city: profile.city, since: record.since };
    }),
  );
  return rows.filter((row) => row !== null).sort((a, b) => b.since.localeCompare(a.since));
}

/** Pings a friend: at most once an hour per pair, and only if they allow pings. */
export async function pingFriend(userId: string, publicId: string, now = Date.now()): Promise<{ ok: true }> {
  await ownProfile(userId);
  const friend = await findByPublicId(publicId);
  if (!friend || !(await areFriends(userId, friend.userId))) {
    throw new NetworkError("You can only ping your friends.", 403);
  }
  if (!privacyOf(friend).allowPings) throw new NetworkError(`${friend.displayName} has pings turned off.`, 403);
  const last = await getDoc<PingRecord>(pingSentKey(userId, friend.userId));
  if (last && now - Date.parse(last.at) < PING_INTERVAL_MS) {
    const minutes = Math.max(1, Math.ceil((PING_INTERVAL_MS - (now - Date.parse(last.at))) / 60_000));
    throw new NetworkError(
      `You already pinged ${friend.displayName} recently. You can ping again in ${minutes} min.`,
      429,
    );
  }
  const at = new Date(now).toISOString();
  await Promise.all([
    putDoc(pingKey(friend.userId, userId), { at } satisfies PingRecord),
    putDoc(pingSentKey(userId, friend.userId), { at } satisfies PingRecord),
  ]);
  return { ok: true };
}

/** Dismisses a ping to you. Twice is fine. */
export async function dismissPing(userId: string, publicId: string): Promise<void> {
  assertUserId(userId);
  const sender = await findByPublicId(publicId);
  if (sender) await deleteDoc(pingKey(userId, sender.userId));
}

/** Pings waiting for this viewer, newest first. Only from people who are still friends. */
export async function listPings(userId: string): Promise<PingView[]> {
  const prefix = `${PINGS}${userId}/`;
  const ids = (await listKeys(prefix)).map((key) => key.slice(prefix.length)).filter(isUserId);
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [profile, record, friends] = await Promise.all([
        getProfile(id),
        getDoc<PingRecord>(pingKey(userId, id)),
        areFriends(userId, id),
      ]);
      if (!profile || profile.isDemo || !record || !friends) return null;
      return { publicId: profile.publicId, displayName: profile.displayName, at: record.at };
    }),
  );
  return rows.filter((row) => row !== null).sort((a, b) => b.at.localeCompare(a.at));
}

/** User ids this viewer has asked and is waiting on. */
export async function outgoingRequestIds(userId: string, candidates: string[]): Promise<Set<string>> {
  const flags = await Promise.all(candidates.map((id) => hasRequest(id, userId)));
  return new Set(candidates.filter((_, index) => flags[index]));
}

/**
 * A friend's courses: title and proven of total skills, newest map first, at most six.
 * Null when they turned sharing off. Map ids never leave the server.
 */
export async function friendCourses(record: ProfileRecord): Promise<FriendCourse[] | null> {
  if (!privacyOf(record).shareProgress) return null;
  const maps = (await listMapsByOwner(record.userId)).filter((map) => map.ownerId === record.userId);
  const courses = await Promise.all(
    maps.slice(0, MAX_FRIEND_COURSES).map(async (map) => {
      const states = deriveNodeStates(map, await getProgress(map.id, record.userId));
      const proven = map.nodes.filter((node) => states[node.id] === "proven").length;
      return { title: map.title, proven, total: map.nodes.length };
    }),
  );
  return courses;
}

/** For "Delete my data": every request and ping to or from this person. */
export async function deleteSocialData(userId: string): Promise<void> {
  const keys = (await Promise.all([REQUESTS, PINGS, PING_SENT].map((prefix) => listKeys(prefix)))).flat();
  const mine = keys.filter((key) => key.split("/").slice(2).includes(userId));
  await Promise.all(mine.map((key) => deleteDoc(key)));
}
