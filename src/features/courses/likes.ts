import { getSkillMap } from "@/features/skill-map";
import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import { CoursesError } from "./errors";
import { countLikes, getListing, likeKey, saveLikeCount } from "./listing";
import { requireLiker } from "./session";
import type { LikeResult } from "./types";

const NOT_PUBLIC = "This course is not public, so it can't be liked. It may have been made private.";
const OWN_COURSE = "You can't like your own course.";

type LikeDoc = { userId: string; likedAt: string };

/** Loads a published course's map, or throws. getSkillMap checks the id before any key is built. */
async function requirePublishedMap(mapId: string) {
  const map = await getSkillMap(mapId);
  if (!map || !(await getListing(map.id))) throw new CoursesError(NOT_PUBLIC, 404);
  return map;
}

/**
 * Counts the like documents and saves the total in `likes/<mapId>/_count`. It never writes
 * the listing, so a like that overlaps an unpublish can't make the course public again,
 * and one that overlaps a republish can't undo the new name. Because every like and unlike
 * recounts, a total that two requests raced on is put right by the next one.
 */
async function recount(mapId: string): Promise<number> {
  const likeCount = await countLikes(mapId);
  await saveLikeCount(mapId, likeCount);
  return likeCount;
}

/** Likes a published course once. Liking again changes nothing. */
export async function likeCourse(mapId: string, userId: string): Promise<LikeResult> {
  const map = await requirePublishedMap(mapId);
  if (map.ownerId === userId) throw new CoursesError(OWN_COURSE, 403);
  requireLiker(userId);

  const key = likeKey(map.id, userId);
  if (!(await getDoc<LikeDoc>(key))) {
    await putDoc(key, { userId, likedAt: new Date().toISOString() } satisfies LikeDoc);
  }
  return { liked: true, likeCount: await recount(map.id) };
}

/** Removes the viewer's like. Unliking a course you never liked changes nothing. */
export async function unlikeCourse(mapId: string, userId: string): Promise<LikeResult> {
  const map = await requirePublishedMap(mapId);
  requireLiker(userId);

  await deleteDoc(likeKey(map.id, userId));
  return { liked: false, likeCount: await recount(map.id) };
}
