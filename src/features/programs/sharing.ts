/**
 * Sharing a program, the way courses share a map: the owner publishes it, anyone with the
 * link (or the /courses directory) can read its outline, and "Start this program" gives a
 * learner their own private copy. The publishing rules (names, sign-in) are the courses' own.
 */
import { randomUUID } from "node:crypto";
import {
  learningOrder,
  MAX_AUTHOR_NAME_LENGTH,
  normalizeAuthorName,
  normalizeQuery,
  requireLearner,
  requirePublisher,
  requireUnpublisher,
  viewerAccess,
} from "@/features/courses";
import { getFinalSyllabus } from "@/features/catalog";
import { copySkillMap, getSkillMap, saveSkillMap, SkillMapError } from "@/features/skill-map";
import { HttpError } from "@/shared/http";
import { getProgramView, PROGRAM_NOT_FOUND, programLink } from "./programs";
import {
  deleteListing,
  getListing,
  getProgram,
  getStart,
  listListings,
  saveListing,
  saveProgram,
  saveStart,
  withClaims,
} from "./storage";
import {
  toPublicProgram,
  type Program,
  type ProgramCourse,
  type ProgramListing,
  type ProgramPage,
  type PublicCourseOutline,
  type PublicProgram,
} from "./types";

export const SIGN_IN_TO_SHARE = "Sign in to share a program, so your name shows on it.";

/** The owner's program, or the same 404 as a missing one for anyone else. getProgram checks the id. */
async function requireOwnProgram(programId: string, userId: string): Promise<Program> {
  const program = await getProgram(programId);
  if (!program || program.ownerId !== userId) throw new HttpError(PROGRAM_NOT_FOUND, 404);
  return program;
}

/** Lists the program publicly. Republishing keeps the first publish date and updates the name. */
export async function publishProgram(
  programId: string,
  userId: string,
  authorName?: string | null,
): Promise<PublicProgram> {
  const program = await requireOwnProgram(programId, userId);
  await requirePublisher(userId, SIGN_IN_TO_SHARE);
  const name = normalizeAuthorName(authorName);
  const existing = await getListing(program.id);
  const now = new Date().toISOString();
  const listing: ProgramListing = {
    programId: program.id,
    title: program.title,
    summary: program.summary,
    authorId: program.ownerId,
    authorName: name,
    courseCount: program.courses.length,
    isSample: Boolean(program.sampleId),
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
  };
  await saveListing(listing);
  return toPublicProgram(listing);
}

/** Makes the program private again. Never needs a sign-in. Learners' copies stay theirs. */
export async function unpublishProgram(programId: string, userId: string): Promise<void> {
  const program = await requireOwnProgram(programId, userId);
  requireUnpublisher(userId);
  await deleteListing(program.id);
}

/** Public programs for the directory, newest first. `q` matches title, summary or author name. */
export async function listPublicPrograms(options: { q?: string } = {}): Promise<PublicProgram[]> {
  const query = normalizeQuery(options.q);
  return (await listListings())
    .filter(
      (listing) =>
        !query ||
        [listing.title, listing.summary, listing.authorName].some((field) => field.toLowerCase().includes(query)),
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title))
    .map(toPublicProgram);
}

/** The viewer's own copy of a public program, if they started it and it still exists and is theirs. */
async function findMyCopy(programId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const start = await getStart(programId, userId);
  if (!start) return null;
  const copy = await getProgram(start.copyId);
  return copy && copy.ownerId === userId ? copy.id : null;
}

/** The author's built course map for each course, only while it still exists and is theirs. */
async function builtMaps(program: Program) {
  const withMaps = await withClaims(program);
  return Promise.all(
    withMaps.courses.map(async (course) => {
      const map = course.mapId ? await getSkillMap(course.mapId) : null;
      return map && map.ownerId === program.ownerId ? map : null;
    }),
  );
}

/**
 * Topic titles per course for the public outline: a catalog course's final syllabus (the same for
 * everyone), else the author's built map, else null.
 */
async function outlineTopics(program: Program): Promise<(string[] | null)[]> {
  if (program.catalogId) {
    const syllabi = await Promise.all(program.courses.map((course) => (course.courseId ? getFinalSyllabus(course.courseId) : null)));
    return syllabi.map((syllabus) => (syllabus ? syllabus.units.flatMap((unit) => unit.topics.map((topic) => topic.title)) : null));
  }
  const maps = await builtMaps(program);
  return maps.map((map) => (map ? learningOrder(map.nodes).map((node) => node.title) : null));
}

/**
 * What /program/[id] shows this viewer. The owner sees their program as always, with the
 * share panel. Anyone else sees a public program's outline, or null (the same as missing)
 * while it is private.
 */
export async function getProgramPage(programId: string, viewerId: string | null): Promise<ProgramPage | null> {
  const program = await getProgram(programId);
  if (!program) return null;

  if (program.ownerId === viewerId) {
    const [view, listing, viewer] = await Promise.all([
      getProgramView(program.id, viewerId),
      getListing(program.id),
      viewerAccess(),
    ]);
    if (!view) return null;
    return {
      mode: "owner",
      program: view,
      sharing: {
        listing: listing ? toPublicProgram(listing) : null,
        signInRequired: viewer.signInRequired,
        displayName: viewer.displayName,
        maxNameLength: MAX_AUTHOR_NAME_LENGTH,
      },
    };
  }

  const listing = await getListing(program.id);
  if (!listing) return null;
  const [topics, myCopyId] = await Promise.all([outlineTopics(program), findMyCopy(program.id, viewerId)]);
  const courses: PublicCourseOutline[] = program.courses.map((course, index) => ({
    slug: course.slug,
    number: index + 1,
    title: course.title,
    summary: course.summary,
    topics: topics[index],
    ...(course.year !== undefined && { year: course.year }),
    ...(course.term !== undefined && { term: course.term }),
    ...(course.level !== undefined && { level: course.level }),
  }));
  return {
    mode: "public",
    program: {
      id: program.id,
      title: program.title,
      summary: program.summary,
      isSample: Boolean(program.sampleId),
      authorName: listing.authorName,
      courses,
      myCopyId,
      ...(program.depth && { depth: program.depth }),
    },
  };
}

export type StartProgramResult = {
  /** The program to open: the learner's copy, or the program itself for its owner. */
  programId: string;
  /** True when this call made a new copy. */
  created: boolean;
};

// On globalThis, because Next.js can load this file more than once and a double click must
// still share one run. Each entry is cleared when its run settles.
const globalStarts = globalThis as typeof globalThis & {
  oryxProgramStarts?: Map<string, Promise<StartProgramResult>>;
};
const inFlight = (globalStarts.oryxProgramStarts ??= new Map());

/**
 * "Start this program": a private copy for the learner with the same plan. A catalog program's
 * copy follows the same catalog program and copies no maps (its content is shared anyway). An
 * older program's built courses are copied (copySkillMap); the rest are built when started. Starting again opens the
 * same copy while it exists. The owner gets their own program back. A private program is
 * the same 404 as a missing one. Concurrent starts by one learner share one run.
 */
export function startProgram(programId: string, userId: string): Promise<StartProgramResult> {
  // Only a lookup key, never a store key, so the ids need no checking yet.
  const key = `${programId}\n${userId}`;
  const running = inFlight.get(key);
  if (running) return running;
  const work = runStart(programId, userId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, work);
  return work;
}

async function runStart(programId: string, userId: string): Promise<StartProgramResult> {
  const program = await getProgram(programId);
  if (!program) throw new HttpError(PROGRAM_NOT_FOUND, 404);
  if (program.ownerId === userId) return { programId: program.id, created: false };
  if (!(await getListing(program.id))) throw new HttpError(PROGRAM_NOT_FOUND, 404);
  requireLearner(userId);

  const existing = await findMyCopy(program.id, userId);
  if (existing) return { programId: existing, created: false };

  const copyId = randomUUID();
  if (program.catalogId) {
    // A catalog program's content is shared: the copy points at the same catalog program and
    // copies no maps. Each course is opened (and shares the canonical syllabus) when started.
    const copy: Program = {
      id: copyId,
      ownerId: userId,
      title: program.title,
      summary: program.summary,
      sourceKind: program.sourceKind,
      sourceText: program.title,
      courses: [],
      createdAt: new Date().toISOString(),
      forkedFrom: program.id,
      catalogId: program.catalogId,
      ...(program.audience !== undefined && { audience: program.audience }),
      ...(program.depth !== undefined && { depth: program.depth }),
    };
    await saveProgram(copy);
    await saveStart(program.id, userId, { copyId, startedAt: copy.createdAt });
    return { programId: copyId, created: true };
  }
  const maps = await builtMaps(program);
  const courses: ProgramCourse[] = await Promise.all(
    program.courses.map(async ({ slug, title, summary, requires, year, term, level, area }, index) => {
      // The author's map id is never carried over: the copy points only at the learner's maps.
      const course: ProgramCourse = {
        slug,
        title,
        summary,
        requires: [...requires],
        // Degree placement, only when set, so a quick program's copy looks exactly like it.
        ...(year !== undefined && { year }),
        ...(term !== undefined && { term }),
        ...(level !== undefined && { level }),
        ...(area !== undefined && { area }),
      };
      const map = maps[index];
      if (!map) return course;
      try {
        // copySkillMap leaves the author's program behind, so the copy is pointed at the learner's.
        const copy = await copySkillMap(map.id, userId);
        await saveSkillMap({ ...copy, program: programLink({ ...program, id: copyId }, index) });
        return { ...course, mapId: copy.id };
      } catch (error) {
        // Deleted since it was read: the learner builds this course when they start it.
        if (error instanceof SkillMapError && error.status === 404) return course;
        throw error;
      }
    }),
  );

  const copy: Program = {
    id: copyId,
    ownerId: userId,
    title: program.title,
    summary: program.summary,
    sourceKind: program.sourceKind,
    sourceText: program.sourceText,
    courses,
    createdAt: new Date().toISOString(),
    forkedFrom: program.id,
    // Only when set, so a copy looks exactly like the program it came from.
    ...(program.sampleId && { sampleId: program.sampleId }),
    ...(program.audience !== undefined && { audience: program.audience }),
    ...(program.depth !== undefined && { depth: program.depth }),
  };
  await saveProgram(copy);
  await saveStart(program.id, userId, { copyId, startedAt: copy.createdAt });
  return { programId: copyId, created: true };
}

/** Forgets runs in flight. Tests only. */
export function resetProgramStartsForTests(): void {
  inFlight.clear();
}
