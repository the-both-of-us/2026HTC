/**
 * Reading and writing `courses/<mapId>`, and the like documents under `likes/<mapId>/`.
 * Ids are validated by callers.
 *
 * Only publishing, unpublishing and seeding write the listing. Likes keep their running
 * total in `likes/<mapId>/_count` instead, so a like can never write an old copy of the
 * listing back over an unpublish or a republish that happened while it ran.
 */
import { getDoc, listDocs, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import type { CourseListing } from "./types";

export function listingKey(mapId: string): string {
  return `courses/${mapId}`;
}

export function likeKey(mapId: string, userId: string): string {
  return `likes/${mapId}/${userId}`;
}

/** Where the running like total lives. User ids are UUIDs, so no like document can have this key. */
export function likeCountKey(mapId: string): string {
  return `likes/${mapId}/_count`;
}

type LikeCountDoc = { likeCount: number; countedAt: string };

export async function getListing(mapId: string): Promise<CourseListing | null> {
  return getDoc<CourseListing>(listingKey(mapId));
}

function isLikeDoc(value: unknown): boolean {
  return typeof (value as { userId?: unknown } | null)?.userId === "string";
}

/**
 * How many like documents a course has. Map ids are a fixed length, so the prefix matches
 * one course only. The `_count` document under the same prefix is not a like, so it is skipped.
 */
export async function countLikes(mapId: string): Promise<number> {
  const docs = await listDocs<unknown>(`likes/${mapId}/`);
  return docs.filter(isLikeDoc).length;
}

/** Saves the running like total. Never touches the listing. */
export async function saveLikeCount(mapId: string, likeCount: number): Promise<void> {
  await putDoc(likeCountKey(mapId), { likeCount, countedAt: new Date().toISOString() } satisfies LikeCountDoc);
}

/**
 * The listing with the current like total. The total in the listing itself is the count at
 * the last publish, and is only used if the `_count` document is missing.
 */
export async function withLikeCount(listing: CourseListing): Promise<CourseListing> {
  const doc = await getDoc<LikeCountDoc>(likeCountKey(listing.mapId));
  return typeof doc?.likeCount === "number" ? { ...listing, likeCount: doc.likeCount } : listing;
}

/**
 * Writes the listing for a map, as a new publish or a republish. A republish keeps the
 * first publishedAt, recounts the likes (and refreshes `_count`), and takes the map's
 * current title and size.
 */
export async function saveListing(
  map: SkillMap,
  options: { authorName: string; isSample: boolean },
): Promise<CourseListing> {
  const [existing, likeCount] = await Promise.all([getListing(map.id), countLikes(map.id)]);
  const now = new Date().toISOString();
  const listing: CourseListing = {
    mapId: map.id,
    title: map.title,
    subtitle: map.subtitle,
    authorId: map.ownerId,
    authorName: options.authorName,
    skillCount: map.nodes.length,
    likeCount,
    isSample: options.isSample,
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
  };
  await Promise.all([putDoc(listingKey(map.id), listing), saveLikeCount(map.id, likeCount)]);
  return listing;
}
