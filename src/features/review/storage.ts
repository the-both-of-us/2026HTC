/** Store reads and writes for review. Every key starts review/<userId>/. */
import { deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";
import type { ReviewCard } from "./types";
import { isUuid } from "@/shared/ids";


/**
 * One UTC day of reviews. firstAt and lastAt are kept because a UTC day touches at most two
 * local days, and the first and last review between them say which ones had activity.
 */
export type DayLog = { count: number; firstAt: string; lastAt: string };

function assertUuid(value: string, what: string): void {
  // Ids end up inside store keys, so anything else is refused before a key is built.
  if (!isUuid(value)) throw new Error(`review: ${what} must be a UUID`);
}

export function userPrefix(userId: string): string {
  assertUuid(userId, "userId");
  return `review/${userId}/`;
}

export function cardKey(userId: string, cardId: string): string {
  assertUuid(cardId, "cardId");
  return `${userPrefix(userId)}${cardId}`;
}

export function logKey(userId: string, day: string): string {
  return `${userPrefix(userId)}log/${day}`;
}

/** Every card state this user has, by card id. Log documents are skipped. */
export async function readStates(userId: string): Promise<Map<string, ReviewCard>> {
  const prefix = userPrefix(userId);
  const keys = (await listKeys(prefix)).filter((key) => isUuid(key.slice(prefix.length)));
  const docs = await Promise.all(keys.map((key) => getDoc<ReviewCard>(key)));
  const states = new Map<string, ReviewCard>();
  for (const doc of docs) if (doc?.cardId) states.set(doc.cardId, doc);
  return states;
}

export async function readState(userId: string, cardId: string): Promise<ReviewCard | null> {
  return getDoc<ReviewCard>(cardKey(userId, cardId));
}

export async function saveState(userId: string, card: ReviewCard): Promise<void> {
  await putDoc(cardKey(userId, card.cardId), card);
}

/**
 * Adds one review to today's log. Two reviews saved at the same instant can each read the old
 * count and lose one; the day still counts as active, which is all a streak needs.
 */
export async function logReview(userId: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const key = logKey(userId, at.slice(0, 10));
  const log = await getDoc<DayLog>(key);
  const next: DayLog = log
    ? {
        count: log.count + 1,
        firstAt: log.firstAt < at ? log.firstAt : at,
        lastAt: log.lastAt > at ? log.lastAt : at,
      }
    : { count: 1, firstAt: at, lastAt: at };
  await putDoc(key, next);
}

export async function readLogs(userId: string): Promise<DayLog[]> {
  const prefix = `${userPrefix(userId)}log/`;
  const docs = await Promise.all((await listKeys(prefix)).map((key) => getDoc<DayLog>(key)));
  return docs.filter((doc): doc is DayLog => doc !== null);
}

/** Removes every review document for this user. Returns how many there were. */
export async function deleteAll(userId: string): Promise<number> {
  const keys = await listKeys(userPrefix(userId));
  await Promise.all(keys.map((key) => deleteDoc(key)));
  return keys.length;
}
