/**
 * "Start this course": a learner gets their own private copy of a published map, so their
 * progress and proofs are theirs. Starting again opens the same copy.
 */
import { copySkillMap, getSkillMap, SkillMapError } from "@/features/skill-map";
import { getDoc, putDoc } from "@/shared/store";
import { COURSE_NOT_FOUND, CoursesError } from "./errors";
import { getListing } from "./listing";
import { requireLearner } from "./session";

export type StartResult = {
  /** The map to open: the learner's copy, or the course itself for its owner. */
  mapId: string;
  /** True when this call made a new copy. */
  created: boolean;
};

/** What `course-starts/<mapId>/<userId>` holds. */
type StartDoc = { copyId: string; startedAt: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Callers check both ids first: the map id through getSkillMap, the user id as a UUID. */
export function startKey(mapId: string, userId: string): string {
  return `course-starts/${mapId}/${userId}`;
}

// On globalThis, because Next.js can load this file more than once and a double click must
// still share one run. Each entry is cleared when its run settles.
const globalStarts = globalThis as typeof globalThis & { oryxCourseStarts?: Map<string, Promise<StartResult>> };
const inFlight = (globalStarts.oryxCourseStarts ??= new Map());

/**
 * The viewer's own copy of a course, if they started it and the copy still exists and is
 * still theirs. `mapId` must already be a checked map id.
 */
export async function findMyCopy(mapId: string, userId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(userId)) return null;
  const doc = await getDoc<StartDoc>(startKey(mapId, userId));
  if (typeof doc?.copyId !== "string") return null;
  const copy = await getSkillMap(doc.copyId);
  return copy && copy.ownerId === userId ? copy.id : null;
}

/**
 * Starts a course for a learner, and returns the map to open.
 *
 * - The owner gets their own map back: it is already theirs.
 * - Anyone else may start only a published course. A private one gets the same 404 as a
 *   missing one, so nobody can tell it exists.
 * - Starting again returns the same copy, unless that copy was deleted, then it makes a new one.
 *
 * Concurrent calls for the same course and learner share one run, so a double click makes
 * one copy. That holds within one server; two servers racing could each make a copy, and
 * the last start document wins.
 */
export function startCourse(mapId: string, userId: string): Promise<StartResult> {
  // Only a lookup key, never a store key, so the ids need no checking yet.
  const key = `${mapId}\n${userId}`;
  const running = inFlight.get(key);
  if (running) return running;
  // No await between the check above and the set below, so concurrent callers share one promise.
  const work = runStart(mapId, userId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, work);
  return work;
}

async function runStart(mapId: string, userId: string): Promise<StartResult> {
  // getSkillMap checks the id is a UUID before any key is built.
  const map = await getSkillMap(mapId);
  if (!map) throw new CoursesError(COURSE_NOT_FOUND, 404);
  if (map.ownerId === userId) return { mapId: map.id, created: false };
  if (!(await getListing(map.id))) throw new CoursesError(COURSE_NOT_FOUND, 404);
  requireLearner(userId);

  const existing = await findMyCopy(map.id, userId);
  if (existing) return { mapId: existing, created: false };

  const copy = await copySkillMap(map.id, userId).catch((error: unknown) => {
    // The course was deleted between the read above and the copy.
    if (error instanceof SkillMapError && error.status === 404) throw new CoursesError(COURSE_NOT_FOUND, 404);
    throw error;
  });
  await putDoc(startKey(map.id, userId), { copyId: copy.id, startedAt: new Date().toISOString() } satisfies StartDoc);
  return { mapId: copy.id, created: true };
}

/** Forgets runs in flight. Tests only. */
export function resetStartStateForTests(): void {
  inFlight.clear();
}
