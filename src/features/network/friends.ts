/**
 * Friends by invite. Store reads and writes only; the rules live in network.ts.
 *
 * Keys:
 * - `network/friends/<userId>/<friendUserId>`: `{since}`, always written for both people.
 * - `network/invites/<code>`: `{code, userId, createdAt}`, claimed with claimDoc. One code
 *   works for any number of friends until its owner makes a new one, which deletes it.
 * - `network/my-invite/<userId>`: `{code}`, so the owner gets the same link back.
 */
import { randomBytes } from "node:crypto";
import { claimDoc, deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";
import { isUserId } from "./session";

const FRIENDS = "network/friends/";
const INVITES = "network/invites/";
const MY_INVITE = "network/my-invite/";

/** 12 base32 characters is 60 random bits: short enough for a link, far too many to guess. */
const CODE_PATTERN = /^[a-z2-7]{12}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

type Friendship = { since: string };
type InviteRecord = { code: string; userId: string; createdAt: string };
type MyInvite = { code: string };

const friendKey = (userId: string, friendId: string) => `${FRIENDS}${userId}/${friendId}`;

function newCode(): string {
  return Array.from(randomBytes(12), (byte) => BASE32[byte % 32]).join("");
}

/** The user ids of this person's friends. */
export async function listFriendIds(userId: string): Promise<string[]> {
  const prefix = `${FRIENDS}${userId}/`;
  return (await listKeys(prefix)).map((key) => key.slice(prefix.length)).filter(isUserId);
}

export async function areFriends(userId: string, otherId: string): Promise<boolean> {
  return (await getDoc<Friendship>(friendKey(userId, otherId))) !== null;
}

/** Writes the link for both people, so each sees the other. */
export async function addFriendship(userId: string, otherId: string): Promise<void> {
  const since = new Date().toISOString();
  await Promise.all([
    putDoc(friendKey(userId, otherId), { since } satisfies Friendship),
    putDoc(friendKey(otherId, userId), { since } satisfies Friendship),
  ]);
}

/** Removes the link both ways. Removing twice is fine. */
export async function removeFriendship(userId: string, otherId: string): Promise<void> {
  await Promise.all([deleteDoc(friendKey(userId, otherId)), deleteDoc(friendKey(otherId, userId))]);
}

/** Codes are lower case, but one typed in capitals still works. Null for anything else. */
export async function getInvite(code: string): Promise<InviteRecord | null> {
  const clean = code.toLowerCase();
  if (!CODE_PATTERN.test(clean)) return null;
  return getDoc<InviteRecord>(`${INVITES}${clean}`);
}

/**
 * This person's invite code. The same one comes back each time, unless `fresh` is set: then
 * the old code is deleted, so its link stops working, and a new one is made.
 */
export async function ownInviteCode(userId: string, fresh: boolean): Promise<string> {
  const mine = await getDoc<MyInvite>(`${MY_INVITE}${userId}`);
  if (mine) {
    const invite = await getInvite(mine.code);
    if (invite?.userId === userId && !fresh) return invite.code;
    if (invite?.userId === userId) await deleteDoc(`${INVITES}${invite.code}`);
  }
  // A clash is one in 2^60, so a second try is plenty; claimDoc makes sure no code is shared.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newCode();
    const record: InviteRecord = {
      code,
      userId,
      createdAt: new Date().toISOString(),
    };
    if (await claimDoc(`${INVITES}${code}`, record)) {
      await putDoc(`${MY_INVITE}${userId}`, { code } satisfies MyInvite);
      return code;
    }
  }
  throw new Error("Could not claim a free invite code");
}

/** For "Delete my data": every friend link (both ways) and the invite. Returns how many friends were removed. */
export async function deleteFriendData(userId: string): Promise<{ friends: number }> {
  const friendIds = await listFriendIds(userId);
  await Promise.all(friendIds.map((friendId) => removeFriendship(userId, friendId)));
  const mine = await getDoc<MyInvite>(`${MY_INVITE}${userId}`);
  if (mine) {
    const invite = await getInvite(mine.code);
    if (invite?.userId === userId) await deleteDoc(`${INVITES}${invite.code}`);
    await deleteDoc(`${MY_INVITE}${userId}`);
  }
  return { friends: friendIds.length };
}
