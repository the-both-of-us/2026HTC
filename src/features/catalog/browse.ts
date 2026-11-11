import { getDoc, listKeys } from "@/shared/store";
import type { CourseSyllabus, ProgramDepth } from "@/shared/types";
import { catalogKeys } from "./identity";
import { isCatalogId } from "./read";
import type { CatalogCourse, CatalogProgram } from "./types";

/**
 * Browsing the shared catalog: what a person can start without anyone waiting on a model.
 * Only courses whose syllabus is final, and programs whose frame is final, are listed. The
 * public shapes are built field by field, so a new server-only field can never leak.
 */

/** Results per request. */
export const MAX_BROWSE_RESULTS = 60;
/** How long the full list is reused, so typing in the search box costs no store reads. */
export const BROWSE_CACHE_MS = 30_000;
const MAX_QUERY_LENGTH = 100;

export type SharedCourse = {
  courseId: string;
  title: string;
  summary: string;
  audience: string;
  /** Counted from the final syllabus. */
  units: number;
  /** Planned topics, counted from the final syllabus. */
  topics: number;
};

export type SharedProgram = {
  programId: string;
  title: string;
  summary: string;
  audience: string;
  /** "quick" is a short path, "degree" a full degree. */
  depth: ProgramDepth;
  courseCount: number;
};

type Entry<T> = { item: T; createdAt: string };
type Snapshot = {
  at: number;
  courses: Entry<SharedCourse>[];
  programs: Entry<SharedProgram>[];
};

const globalCache = globalThis as typeof globalThis & { oryxBrowseCache?: { snapshot?: Snapshot; loading?: Promise<Snapshot> } };
const cache = (globalCache.oryxBrowseCache ??= {});

export function toSharedCourse(course: CatalogCourse, syllabus: CourseSyllabus): SharedCourse {
  return {
    courseId: course.id,
    title: course.title,
    summary: course.summary,
    audience: course.audience,
    units: syllabus.units.length,
    topics: syllabus.units.reduce((sum, unit) => sum + unit.topics.length, 0),
  };
}

export function toSharedProgram(program: CatalogProgram): SharedProgram {
  return {
    programId: program.id,
    title: program.title,
    summary: program.summary,
    audience: program.audience,
    depth: program.depth,
    courseCount: program.courses.length,
  };
}

function idsUnder(keys: string[], prefix: string): string[] {
  return keys.map((key) => key.slice(prefix.length)).filter(isCatalogId);
}

async function load(): Promise<Snapshot> {
  const coursePrefix = catalogKeys.course("");
  const programPrefix = catalogKeys.program("");
  const [courseKeys, programKeys] = await Promise.all([listKeys(coursePrefix), listKeys(programPrefix)]);
  const [courses, programs] = await Promise.all([
    Promise.all(
      idsUnder(courseKeys, coursePrefix).map(async (id) => {
        const [course, syllabus] = await Promise.all([
          getDoc<CatalogCourse>(catalogKeys.course(id)),
          getDoc<CourseSyllabus>(catalogKeys.syllabus(id)),
        ]);
        // A syllabus counts only when it is final and has something to study.
        if (!course || !syllabus || syllabus.planning || syllabus.units.length === 0) return null;
        return { item: toSharedCourse(course, syllabus), createdAt: course.createdAt ?? "" };
      }),
    ),
    Promise.all(
      idsUnder(programKeys, programPrefix).map(async (id) => {
        const program = await getDoc<CatalogProgram>(catalogKeys.program(id));
        if (!program || program.courses.length === 0) return null;
        return { item: toSharedProgram(program), createdAt: program.createdAt ?? "" };
      }),
    ),
  ]);
  const newestFirst = <T>(a: Entry<T>, b: Entry<T>) => b.createdAt.localeCompare(a.createdAt);
  return {
    at: Date.now(),
    courses: courses.filter((entry): entry is Entry<SharedCourse> => entry !== null).sort(newestFirst),
    programs: programs.filter((entry): entry is Entry<SharedProgram> => entry !== null).sort(newestFirst),
  };
}

async function snapshot(): Promise<Snapshot> {
  if (cache.snapshot && Date.now() - cache.snapshot.at < BROWSE_CACHE_MS) return cache.snapshot;
  // Concurrent callers share one load.
  cache.loading ??= load()
    .then((loaded) => {
      cache.snapshot = loaded;
      return loaded;
    })
    .finally(() => {
      cache.loading = undefined;
    });
  return cache.loading;
}

/** Same matching as the course directory: trimmed, lower-cased, a substring of the title or summary. */
export function normalizeBrowseQuery(input: string | null | undefined): string {
  return (input ?? "").trim().slice(0, MAX_QUERY_LENGTH).toLowerCase();
}

function matches(item: { title: string; summary: string }, query: string): boolean {
  return !query || [item.title, item.summary].some((field) => field.toLowerCase().includes(query));
}

/** Shared catalog courses with a final syllabus, newest first, at most 60. `q` matches title or summary. */
export async function listSharedCourses(options: { q?: string } = {}): Promise<SharedCourse[]> {
  const query = normalizeBrowseQuery(options.q);
  return (await snapshot()).courses
    .filter((entry) => matches(entry.item, query))
    .slice(0, MAX_BROWSE_RESULTS)
    .map((entry) => ({ ...entry.item }));
}

/** Shared catalog programs with a final frame, newest first, at most 60. `q` matches title or summary. */
export async function listSharedPrograms(options: { q?: string } = {}): Promise<SharedProgram[]> {
  const query = normalizeBrowseQuery(options.q);
  return (await snapshot()).programs
    .filter((entry) => matches(entry.item, query))
    .slice(0, MAX_BROWSE_RESULTS)
    .map((entry) => ({ ...entry.item }));
}

/** Forgets the cached list. Tests only. */
export function resetBrowseCacheForTests(): void {
  cache.snapshot = undefined;
  cache.loading = undefined;
}
