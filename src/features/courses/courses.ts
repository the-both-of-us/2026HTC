import { deriveNodeStates, getSkillMap } from "@/features/skill-map";
import { getProgress } from "@/features/teachback";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { deleteDoc, getDoc, listDocs } from "@/shared/store";
import type { NodeState, SkillMap } from "@/shared/types";
import { COURSE_NOT_FOUND, CoursesError } from "./errors";
import { getListing, likeKey, listingKey, saveListing, withLikeCount } from "./listing";
import {
  isSamplePostingText,
  learningOrder,
  matchesQuery,
  normalizeAuthorName,
  normalizeQuery,
  sortListings,
} from "./rules";
import { ensureSampleCourses, SEED_OWNER_ID } from "./seed";
import { requirePublisher, requireUnpublisher, viewerAccess } from "./session";
import { findMyCopy } from "./start";
import { toPublicCourse, type CourseDetail, type CourseListing, type CourseSort, type PublicCourse } from "./types";

const MAP_NOT_FOUND = "We could not find that map. Check the link, or build a new one.";
const NOT_YOURS = "Only the person who built this map can publish it or make it private.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Loads the map, or throws a 404 sentence. getSkillMap checks the id before any key is built. */
async function requireMap(mapId: string, notFound = MAP_NOT_FOUND): Promise<SkillMap> {
  const map = await getSkillMap(mapId);
  if (!map) throw new CoursesError(notFound, 404);
  return map;
}

/** Publishing needs a sign-in once Auth0 is set up. Making a course private never does. */
async function requireOwnedMap(mapId: string, userId: string, action: "publish" | "unpublish"): Promise<SkillMap> {
  const map = await requireMap(mapId);
  if (map.ownerId !== userId) throw new CoursesError(NOT_YOURS, 403);
  if (action === "publish") await requirePublisher(userId);
  else requireUnpublisher(userId);
  return map;
}

function isListing(value: unknown): value is CourseListing {
  const listing = value as Partial<CourseListing> | null;
  return (
    typeof listing?.mapId === "string" &&
    typeof listing.title === "string" &&
    typeof listing.subtitle === "string" &&
    typeof listing.authorName === "string" &&
    typeof listing.likeCount === "number" &&
    typeof listing.publishedAt === "string"
  );
}

/** The public directory. Seeds the sample courses first if they are missing. */
export async function listCourses(options: { sort: CourseSort; q?: string }): Promise<PublicCourse[]> {
  const sampleIds = new Set(await ensureSampleCourses());
  // Only hide a seeded listing as a duplicate when every sample's current map is known.
  // Showing a rare duplicate is better than hiding a real sample after one failed read.
  const allSamplesKnown = sampleIds.size >= SAMPLE_POSTINGS.length;
  const query = normalizeQuery(options.q);
  const matching = (await listDocs<unknown>("courses/"))
    .filter(isListing)
    // A seeded listing that is not the current seed is a duplicate from two servers seeding at
    // once. This keys on the seed owner, not isSample: a learner's course made from a sample
    // posting is also labelled a sample, and it must still be listed.
    .filter((listing) => !allSamplesKnown || listing.authorId !== SEED_OWNER_ID || sampleIds.has(listing.mapId))
    .filter((listing) => matchesQuery(listing, query));
  const listings = await Promise.all(matching.map(withLikeCount));
  return sortListings(listings, options.sort).map(toPublicCourse);
}

/**
 * One course for one viewer. A private course is visible only to its owner: anyone else
 * gets the same 404 as a missing map, so they can't tell a private map exists.
 */
export async function getCourse(mapId: string, viewerId: string): Promise<CourseDetail> {
  const map = await requireMap(mapId, COURSE_NOT_FOUND);
  const isOwner = map.ownerId === viewerId;
  const saved = await getListing(map.id);
  if (!saved && !isOwner) throw new CoursesError(COURSE_NOT_FOUND, 404);
  const listing = saved ? await withLikeCount(saved) : null;

  const [likedByMe, myCopyId, viewer] = await Promise.all([
    UUID_PATTERN.test(viewerId) ? getDoc(likeKey(map.id, viewerId)).then((like) => like !== null) : false,
    // The owner's map is already theirs, so they never have a copy to continue.
    isOwner ? null : findMyCopy(map.id, viewerId),
    viewerAccess(),
  ]);
  const skillStates = await viewerSkillStates(map, isOwner ? map.id : myCopyId, viewerId);

  return {
    course: listing ? toPublicCourse(listing) : null,
    title: map.title,
    subtitle: map.subtitle,
    published: listing !== null,
    isSample: listing?.isSample ?? isSamplePostingText(map.sourceText),
    isOwner,
    likedByMe,
    myCopyId,
    signedIn: viewer.signedIn,
    signInRequired: viewer.signInRequired,
    displayName: viewer.displayName,
    skills: learningOrder(map.nodes).map((node) => ({
      id: node.id,
      title: node.title,
      why: node.why,
      fromSource: node.fromSource,
    })),
    skillStates,
  };
}

/**
 * The viewer's state on each skill, from their own map of this course. A copy keeps the
 * course's skill ids and prerequisites, so the course's nodes describe it. Progress is a
 * nicety on this page, so a failure shows the course without it.
 */
async function viewerSkillStates(
  map: SkillMap,
  viewerMapId: string | null,
  viewerId: string,
): Promise<Record<string, NodeState> | null> {
  if (!viewerMapId) return null;
  try {
    return deriveNodeStates(map, await getProgress(viewerMapId, viewerId));
  } catch (error) {
    console.error("[courses] could not read progress for the course page", error);
    return null;
  }
}

/**
 * Lists the map in the directory. Owner only. Republishing keeps the first publish date and
 * the likes. A map built from a sample posting is labelled a sample, because its job ad is fictional.
 */
export async function publishCourse(mapId: string, userId: string, authorName?: string | null): Promise<PublicCourse> {
  const map = await requireOwnedMap(mapId, userId, "publish");
  const name = normalizeAuthorName(authorName);
  const listing = await saveListing(map, { authorName: name, isSample: isSamplePostingText(map.sourceText) });
  return toPublicCourse(listing);
}

/** Takes the course out of the directory. Owner only. Like documents stay, so republishing restores the count. */
export async function unpublishCourse(mapId: string, userId: string): Promise<void> {
  const map = await requireOwnedMap(mapId, userId, "unpublish");
  await deleteDoc(listingKey(map.id));
}

/**
 * True when the map is listed in the directory. For the map route, which will hide
 * unpublished maps from everyone but their owner. Checks the id itself, so it costs one read.
 */
export async function isPublished(mapId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(mapId)) return false;
  return (await getListing(mapId)) !== null;
}
