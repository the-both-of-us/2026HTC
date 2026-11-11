import { randomUUID } from "node:crypto";
import { claimDoc, deleteDoc, getDoc, putDoc } from "@/shared/store";
import type { ProgramDepth } from "@/shared/types";
import { aliasHash, audKey, catalogKeys, titleKey } from "./identity";
import { isCatalogId } from "./read";
import type { CatalogClaim, CatalogCourse, CatalogNameEntry, CatalogProgramSeed } from "./types";

const oneLine = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

function courseIdOf(entry: CatalogNameEntry | null): string | null {
  return entry && "courseId" in entry && isCatalogId(entry.courseId) ? entry.courseId : null;
}

function programIdOf(entry: CatalogNameEntry | null): string | null {
  return entry && "programId" in entry && isCatalogId(entry.programId) ? entry.programId : null;
}

export async function readCourseEntry(key: string): Promise<string | null> {
  return courseIdOf(await getDoc<CatalogNameEntry>(key));
}

export async function readProgramEntry(key: string): Promise<string | null> {
  return programIdOf(await getDoc<CatalogNameEntry>(key));
}

/** The course this exact title names for this audience, if any. One read, no model call. */
export async function findCourseByName(title: string, audience: string): Promise<string | null> {
  const key = titleKey(title);
  if (!key) return null;
  return readCourseEntry(catalogKeys.courseName(audKey(audience), key));
}

/** Points this phrasing at a course. The first claim wins; a later one changes nothing. */
export async function claimCourseAlias(text: string, audience: string, courseId: string): Promise<void> {
  if (!titleKey(text)) return;
  await claimDoc(catalogKeys.courseAlias(audKey(audience), aliasHash(text)), { courseId } satisfies CatalogNameEntry);
}

export async function claimProgramAlias(text: string, audience: string, depth: ProgramDepth, programId: string): Promise<void> {
  if (!titleKey(text)) return;
  await claimDoc(catalogKeys.programAlias(audKey(audience), depth, aliasHash(text)), { programId } satisfies CatalogNameEntry);
}

/**
 * The claim order for a new catalog entry, whose doc is already written under `id`:
 * 1. the alias for this phrasing: a lost claim means an identical request got there first, so
 *    its id is used and our doc is deleted (nobody can have found it);
 * 2. the name for the canonical title: a lost claim means an entry with the same title already
 *    exists (another phrasing, or a program line, at the same moment), so our alias is re-pointed
 *    at it and its id is used. Our doc stays, unreachable, in case someone joined us in between.
 */
async function claimNew(input: {
  id: string;
  docKey: string;
  aliasKey: string;
  nameKey: string | null;
  entry: (id: string) => CatalogNameEntry;
  read: (key: string) => Promise<string | null>;
}): Promise<CatalogClaim> {
  if (!(await claimDoc(input.aliasKey, input.entry(input.id)))) {
    const winner = await input.read(input.aliasKey);
    if (winner) {
      await deleteDoc(input.docKey);
      return { id: winner, created: false };
    }
  }
  if (input.nameKey && !(await claimDoc(input.nameKey, input.entry(input.id)))) {
    const named = await input.read(input.nameKey);
    if (named && named !== input.id) {
      await putDoc(input.aliasKey, input.entry(named));
      return { id: named, created: false };
    }
  }
  return { id: input.id, created: true };
}

/**
 * After a "new" resolution: writes the CatalogCourse under a new id, then claims the alias for
 * this phrasing and the name for its title (see claimNew). `created` is false when another
 * request's course with the same phrasing or title won: its id is returned.
 */
export async function claimCourse(input: {
  text: string;
  audience: string;
  title: string;
  summary: string;
  level?: CatalogCourse["level"];
  area?: string;
  home?: { programId: string; slug: string };
}): Promise<CatalogClaim> {
  const aud = audKey(input.audience);
  const id = randomUUID();
  const course: CatalogCourse = {
    id,
    title: oneLine(input.title, 80),
    summary: oneLine(input.summary, 200),
    audience: input.audience,
    ...(input.level && { level: input.level }),
    ...(input.area && { area: oneLine(input.area, 40) }),
    ...(input.home && { homeProgramId: input.home.programId, homeSlug: input.home.slug }),
    createdAt: new Date().toISOString(),
  };
  // The doc goes first, so anyone who finds the alias or name can read the course.
  await putDoc(catalogKeys.course(id), course);
  const name = titleKey(course.title);
  return claimNew({
    id,
    docKey: catalogKeys.course(id),
    aliasKey: catalogKeys.courseAlias(aud, aliasHash(input.text || input.title)),
    nameKey: name ? catalogKeys.courseName(aud, name) : null,
    entry: (courseId) => ({ courseId }),
    read: readCourseEntry,
  });
}

/**
 * After a "new" resolution: writes the program's seed under a new id, then claims the program
 * alias and name (see claimNew). It does not write `catalog/programs/<id>`: that key is the
 * final frame, written once by the planner under `startOnce`. Until then `readCatalogProgram`
 * assembles a "planning" program from the seed and the partial doc.
 */
export async function claimProgram(input: {
  text: string;
  audience: string;
  depth: ProgramDepth;
  title: string;
  summary: string;
}): Promise<CatalogClaim> {
  const aud = audKey(input.audience);
  const id = randomUUID();
  const seed: CatalogProgramSeed = {
    id,
    title: oneLine(input.title, 80),
    summary: oneLine(input.summary, 240),
    audience: input.audience,
    depth: input.depth,
    createdAt: new Date().toISOString(),
  };
  await putDoc(catalogKeys.programSeed(id), seed);
  const name = titleKey(seed.title);
  return claimNew({
    id,
    docKey: catalogKeys.programSeed(id),
    aliasKey: catalogKeys.programAlias(aud, input.depth, aliasHash(input.text || input.title)),
    nameKey: name ? catalogKeys.programName(aud, input.depth, name) : null,
    entry: (programId) => ({ programId }),
    read: readProgramEntry,
  });
}
