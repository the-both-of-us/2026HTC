import { HttpError } from "@/shared/http";
import { deleteDoc, listKeys, putDoc } from "@/shared/store";

/**
 * Likes and saves, one document per viewer and card: feed-like/<userId>/<cardId>. Setting the
 * same value twice changes nothing, so a retried tap is harmless.
 */
export type Reaction = "like" | "save";

const CARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\d{1,2}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const prefix = (reaction: Reaction, userId: string) => `feed-${reaction}/${userId}/`;

export function isCardId(value: string): boolean {
  return CARD_ID_PATTERN.test(value);
}

export async function setReaction(userId: string, reaction: Reaction, cardId: string, on: boolean): Promise<{ on: boolean }> {
  if (!UUID_PATTERN.test(userId) || !isCardId(cardId)) {
    throw new HttpError("We could not find that card. Please refresh the feed.", 404);
  }
  const key = `${prefix(reaction, userId)}${cardId}`;
  if (on) await putDoc(key, { at: new Date().toISOString() });
  else await deleteDoc(key);
  return { on };
}

/** The card ids this viewer liked or saved. */
export async function listReactions(userId: string, reaction: Reaction): Promise<Set<string>> {
  if (!UUID_PATTERN.test(userId)) return new Set();
  const keys = await listKeys(prefix(reaction, userId));
  return new Set(keys.map((key) => key.slice(key.lastIndexOf("/") + 1)));
}

/** For "Delete my data": this viewer's likes and saves. Running it twice is harmless. */
export async function deleteFeedData(userId: string): Promise<void> {
  if (!UUID_PATTERN.test(userId)) return;
  const keys = (await Promise.all((["like", "save"] as const).map((reaction) => listKeys(prefix(reaction, userId))))).flat();
  await Promise.all(keys.map((key) => deleteDoc(key)));
}
