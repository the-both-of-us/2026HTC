import { HttpError } from "@/shared/http";
import { deleteDoc, listKeys, putDoc } from "@/shared/store";
import { deleteViewerComments } from "./comments";
import { deleteViewerEvents, removeEvent, writeEvent } from "./events";
import { deleteInterests } from "./interests";
import { slugOfItem } from "./validate";
import { isUuid } from "@/shared/ids";

/**
 * Likes and saves. Each is kept twice: feed-<reaction>/<userId>/<itemId> for the viewer's
 * Saved tab, and as an engagement event (feed-ev/<itemId>/<reaction>/<userId>) for ranking.
 * Setting the same value twice changes nothing, so a retried tap is harmless.
 */
export type Reaction = "like" | "save";

const prefix = (reaction: Reaction, userId: string) => `feed-${reaction}/${userId}/`;

export async function setReaction(userId: string, reaction: Reaction, itemId: string, on: boolean): Promise<{ on: boolean }> {
  if (!isUuid(userId) || !slugOfItem(itemId)) {
    throw new HttpError("We could not find that card. Please refresh the feed.", 404);
  }
  const key = `${prefix(reaction, userId)}${itemId}`;
  if (on) await Promise.all([putDoc(key, { at: new Date().toISOString() }), writeEvent(userId, itemId, reaction)]);
  else await Promise.all([deleteDoc(key), removeEvent(userId, itemId, reaction)]);
  return { on };
}

/** The item ids this viewer liked or saved. */
export async function listReactions(userId: string, reaction: Reaction): Promise<Set<string>> {
  if (!isUuid(userId)) return new Set();
  const keys = await listKeys(prefix(reaction, userId));
  return new Set(keys.map((key) => key.slice(key.lastIndexOf("/") + 1)));
}

/** For "Delete my data": this viewer's interests, likes, saves, comments and engagement. Running it twice is harmless. */
export async function deleteFeedData(userId: string): Promise<void> {
  if (!isUuid(userId)) return;
  const keys = (await Promise.all((["like", "save"] as const).map((reaction) => listKeys(prefix(reaction, userId))))).flat();
  await Promise.all([...keys.map((key) => deleteDoc(key)), deleteInterests(userId), deleteViewerEvents(userId), deleteViewerComments(userId)]);
}
