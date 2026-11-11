import { deleteDoc, listKeys } from "@/shared/store";
import { countLikes, likeCountKey, saveLikeCount } from "./listing";
import { isUuid } from "@/shared/ids";

/** What deleteUserData removed, so the trust page can say it in numbers. */
export type DeletedCourseData = { likes: number; courseStarts: number };


/**
 * User and map ids are UUIDs. Anything else is refused, so an id can never reach into
 * another prefix or match the `_count` like total.
 */
function isSafeSegment(value: string): boolean {
  return isUuid(value);
}

/** Keys shaped `<prefix><mapId>/<userId>` whose last part is this user. */
async function keysForUser(prefix: string, userId: string): Promise<{ key: string; mapId: string }[]> {
  const keys = await listKeys(prefix);
  return keys.flatMap((key) => {
    const [mapId, owner, ...rest] = key.slice(prefix.length).split("/");
    return owner === userId && rest.length === 0 && mapId ? [{ key, mapId }] : [];
  });
}

/**
 * Deletes what one person left in courses: their likes on other people's courses (and puts
 * those courses' like totals right) and their "started this course" records.
 *
 * `ownMapIds` are the user's own maps, which "Delete my data" removes next. Their like and
 * start records, which other people made, would otherwise point at nothing, so they go too.
 * The user's listings are removed by unpublishCourse, and their copies are maps, so neither
 * is handled here.
 *
 * Only this user's records change, and running it twice is harmless.
 */
export async function deleteUserData(userId: string, ownMapIds: string[] = []): Promise<DeletedCourseData> {
  if (!isSafeSegment(userId)) return { likes: 0, courseStarts: 0 };

  const likes = await keysForUser("likes/", userId);
  await Promise.all(likes.map(({ key }) => deleteDoc(key)));
  const touched = [...new Set(likes.map(({ mapId }) => mapId))];
  await Promise.all(touched.map(async (mapId) => saveLikeCount(mapId, await countLikes(mapId))));

  const starts = await keysForUser("course-starts/", userId);
  await Promise.all(starts.map(({ key }) => deleteDoc(key)));

  const own = ownMapIds.filter(isSafeSegment);
  await Promise.all(
    own.map(async (mapId) => {
      const keys = [...(await listKeys(`likes/${mapId}/`)), ...(await listKeys(`course-starts/${mapId}/`))];
      await Promise.all([...keys, likeCountKey(mapId)].map((key) => deleteDoc(key)));
    }),
  );

  return { likes: likes.length, courseStarts: starts.length };
}
