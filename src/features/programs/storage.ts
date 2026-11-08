import { claimDoc, deleteDoc, getDoc, listDocs, listKeys, putDoc } from "@/shared/store";
import type { Program, ProgramListing } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is building a course's map, and under which id. Claimed once, so two clicks make one map. */
export type CourseClaim = { mapId: string; claimedAt: string };

const programKey = (id: string) => `programs/${id}`;
/** Present means the program is public. Ids are checked as UUIDs before a key is built. */
const listingKey = (programId: string) => `program-listings/${programId}`;
/** A learner's own copy of a public program, so starting again opens it. */
const startKey = (programId: string, userId: string) => `program-starts/${programId}/${userId}`;
const claimKey = (programId: string, slug: string) => `program-courses/${programId}/${slug}`;

/**
 * The owner index: `programs-by-owner/<ownerId>/<programId>` exists for every program,
 * so one person's programs are found by listing their own keys, never by reading all.
 */
const OWNER_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const ownerIndexPrefix = (ownerId: string) => `programs-by-owner/${ownerId}/`;
const ownerIndexKey = (ownerId: string, programId: string) => `${ownerIndexPrefix(ownerId)}${programId}`;
/** Present once every program saved before the index existed has an entry. */
const OWNER_INDEX_READY_KEY = "indexes/programs-by-owner-v1";

async function indexProgram(program: Pick<Program, "id" | "ownerId">): Promise<void> {
  if (!OWNER_ID_PATTERN.test(program.ownerId)) {
    console.warn("[programs] a program's owner id cannot go in a key, so the program is not indexed");
    return;
  }
  await putDoc(ownerIndexKey(program.ownerId, program.id), { programId: program.id });
}

let catchingUp: Promise<void> | null = null;

/** Indexes programs saved before the index existed, once per store. See skill-map's storage. */
async function ensureOwnerIndex(): Promise<void> {
  if (await getDoc(OWNER_INDEX_READY_KEY)) return;
  catchingUp ??= (async () => {
    const programs = await listDocs<Program>("programs/");
    await Promise.all(programs.map(indexProgram));
    await putDoc(OWNER_INDEX_READY_KEY, { indexedAt: new Date().toISOString(), programs: programs.length });
  })().finally(() => {
    catchingUp = null;
  });
  await catchingUp;
}

export async function saveProgram(program: Program): Promise<void> {
  await putDoc(programKey(program.id), program);
  await indexProgram(program);
}

/** Returns the program, or null. The id comes from a URL, so it must look like one of ours. */
export async function getProgram(id: string): Promise<Program | null> {
  if (!UUID_PATTERN.test(id)) return null;
  return getDoc<Program>(programKey(id));
}

export async function claimCourse(programId: string, slug: string, claim: CourseClaim): Promise<boolean> {
  return claimDoc(claimKey(programId, slug), claim);
}

export async function getCourseClaim(programId: string, slug: string): Promise<CourseClaim | null> {
  return getDoc<CourseClaim>(claimKey(programId, slug));
}

export async function releaseCourse(programId: string, slug: string): Promise<void> {
  await deleteDoc(claimKey(programId, slug));
}

/**
 * Records a built course's map id on the program. Two courses saved at the same moment
 * could overwrite each other here, so readers also check the claims (see withClaims).
 */
export async function saveCourseMapId(programId: string, slug: string, mapId: string): Promise<void> {
  const program = await getProgram(programId);
  if (!program) return;
  const courses = program.courses.map((course) => (course.slug === slug ? { ...course, mapId } : course));
  await saveProgram({ ...program, courses });
}

/** Fills in any map id that only its claim knows about yet. */
export async function withClaims(program: Program): Promise<Program> {
  const claims = await Promise.all(
    program.courses.map((course) => (course.mapId ? null : getCourseClaim(program.id, course.slug))),
  );
  const courses = program.courses.map((course, index) => ({
    ...course,
    mapId: course.mapId ?? claims[index]?.mapId,
  }));
  return { ...program, courses };
}

/**
 * One user's programs, newest first. Reads only this owner's index entries and their
 * programs. A stale entry is removed or skipped, so the index can only narrow the answer.
 */
export async function listProgramsByOwner(ownerId: string): Promise<Program[]> {
  if (!OWNER_ID_PATTERN.test(ownerId)) return [];
  await ensureOwnerIndex();

  const prefix = ownerIndexPrefix(ownerId);
  const ids = (await listKeys(prefix)).map((key) => key.slice(prefix.length)).filter((id) => UUID_PATTERN.test(id));
  const programs = await Promise.all(
    ids.map(async (id) => {
      const program = await getDoc<Program>(programKey(id));
      if (!program) await deleteDoc(ownerIndexKey(ownerId, id));
      return program;
    }),
  );
  return programs
    .filter((program): program is Program => program !== null && program.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A program as a list row, for "My programs" in /courses or the dashboard. No owner id, no source text. */
export type ProgramSummary = { id: string; title: string; summary: string; courseCount: number; href: string };

export async function listMyPrograms(userId: string): Promise<ProgramSummary[]> {
  const programs = await listProgramsByOwner(userId);
  return programs.map((program) => ({
    id: program.id,
    title: program.title,
    summary: program.summary,
    courseCount: program.courses.length,
    href: `/program/${program.id}`,
  }));
}

function isListing(value: unknown): value is ProgramListing {
  const listing = value as Partial<ProgramListing> | null;
  return (
    typeof listing?.programId === "string" &&
    UUID_PATTERN.test(listing.programId) &&
    typeof listing.title === "string" &&
    typeof listing.summary === "string" &&
    typeof listing.authorId === "string" &&
    typeof listing.authorName === "string" &&
    typeof listing.courseCount === "number" &&
    typeof listing.publishedAt === "string"
  );
}

/** The program's public listing, or null while it is private. */
export async function getListing(programId: string): Promise<ProgramListing | null> {
  if (!UUID_PATTERN.test(programId)) return null;
  const listing = await getDoc<unknown>(listingKey(programId));
  return isListing(listing) ? listing : null;
}

export async function saveListing(listing: ProgramListing): Promise<void> {
  if (!UUID_PATTERN.test(listing.programId)) throw new Error("A program listing needs a program id");
  await putDoc(listingKey(listing.programId), listing);
}

export async function deleteListing(programId: string): Promise<void> {
  if (!UUID_PATTERN.test(programId)) return;
  await deleteDoc(listingKey(programId));
}

/** Every public program. Each holds the owner id, so callers must make them public first. */
export async function listListings(): Promise<ProgramListing[]> {
  return (await listDocs<unknown>("program-listings/")).filter(isListing);
}

/** What `program-starts/<programId>/<userId>` holds. */
export type ProgramStart = { copyId: string; startedAt: string };

export async function getStart(programId: string, userId: string): Promise<ProgramStart | null> {
  if (!UUID_PATTERN.test(programId) || !UUID_PATTERN.test(userId)) return null;
  const doc = await getDoc<ProgramStart>(startKey(programId, userId));
  return typeof doc?.copyId === "string" && UUID_PATTERN.test(doc.copyId) ? doc : null;
}

export async function saveStart(programId: string, userId: string, start: ProgramStart): Promise<void> {
  if (!UUID_PATTERN.test(programId) || !UUID_PATTERN.test(userId)) throw new Error("A program start needs ids");
  await putDoc(startKey(programId, userId), start);
}

/**
 * For "Delete my data": removes this user's programs, their course claims and listings, the
 * start records other people left on them, and this user's own start records on others'
 * programs. The course maps themselves are maps, so they go with the user's other maps.
 * Only this user's records change, and running it twice is harmless.
 */
export async function deleteProgramsByOwner(ownerId: string): Promise<number> {
  const programs = await listProgramsByOwner(ownerId);
  for (const program of programs) {
    const keys = [
      ...(await listKeys(`program-courses/${program.id}/`)),
      ...(await listKeys(`program-starts/${program.id}/`)),
    ];
    await Promise.all(keys.map((key) => deleteDoc(key)));
    await deleteListing(program.id);
    await deleteDoc(programKey(program.id));
    await deleteDoc(ownerIndexKey(ownerId, program.id));
  }

  if (UUID_PATTERN.test(ownerId)) {
    const prefix = "program-starts/";
    const mine = (await listKeys(prefix)).filter((key) => {
      const [programId, userId, ...rest] = key.slice(prefix.length).split("/");
      return Boolean(programId) && userId === ownerId && rest.length === 0;
    });
    await Promise.all(mine.map((key) => deleteDoc(key)));
  }
  return programs.length;
}
