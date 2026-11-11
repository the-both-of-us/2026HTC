import { getDoc } from "@/shared/store";
import { readOnce } from "@/shared/store/once";
import { SYLLABUS_SHAPE, type CourseSyllabus } from "@/shared/types";
import { catalogKeys } from "./identity";
import type {
  CatalogCourse,
  CatalogProgram,
  CatalogProgramCourse,
  CatalogProgramRead,
  CatalogProgramSeed,
  CatalogSyllabusRead,
  ProgramPart,
  SyllabusPart,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Catalog ids are server-made UUIDs; anything else is never turned into a key. */
export const isCatalogId = (id: unknown): id is string => typeof id === "string" && UUID_PATTERN.test(id);

export async function getCatalogCourse(courseId: string): Promise<CatalogCourse | null> {
  if (!isCatalogId(courseId)) return null;
  return getDoc<CatalogCourse>(catalogKeys.course(courseId));
}

export async function getProgramSeed(programId: string): Promise<CatalogProgramSeed | null> {
  if (!isCatalogId(programId)) return null;
  return getDoc<CatalogProgramSeed>(catalogKeys.programSeed(programId));
}

/** Course lines in order, each with the courseId its "registered" part set, if any. */
export function assembleCourses(parts: ProgramPart[]): CatalogProgramCourse[] {
  const courses: CatalogProgramCourse[] = [];
  const bySlug = new Map<string, CatalogProgramCourse>();
  for (const part of parts) {
    if (part?.kind === "course" && part.course && !bySlug.has(part.course.slug)) {
      const course = { ...part.course };
      courses.push(course);
      bySlug.set(course.slug, course);
    } else if (part?.kind === "registered") {
      const course = bySlug.get(part.slug);
      if (course) course.courseId = part.courseId;
    }
  }
  return courses;
}

/** A program assembled from its seed and the parts planned so far. */
export function assembleProgram(seed: CatalogProgramSeed, parts: ProgramPart[]): CatalogProgram {
  const head = parts.find((part): part is Extract<ProgramPart, { kind: "head" }> => part?.kind === "head");
  return {
    id: seed.id,
    title: head?.title || seed.title,
    summary: head?.summary || seed.summary,
    audience: seed.audience,
    depth: seed.depth,
    status: "planning",
    courses: assembleCourses(parts),
    createdAt: seed.createdAt,
  };
}

/** The program and where its frame stands, or null when there is no such program. At most four reads. */
/**
 * A program claimed this recently with no planner yet counts as planning, not stalled: its planner
 * starts in after(), just after the create response, so the first poll can beat it. A dead claim
 * is always older than this (130 s with no heartbeat), so the grace never hides a real stall.
 */
export const PLANNING_START_GRACE_MS = 20_000;

export async function readCatalogProgram(programId: string): Promise<CatalogProgramRead | null> {
  if (!isCatalogId(programId)) return null;
  const read = await readOnce<CatalogProgram, ProgramPart>(catalogKeys.program(programId));
  if (read.state === "ready") return { state: "ready", program: read.value };
  const seed = await getProgramSeed(programId);
  if (!seed) return null;
  if (read.state === "running") return { state: "planning", program: assembleProgram(seed, read.parts) };
  const starting = Date.now() - Date.parse(seed.createdAt) < PLANNING_START_GRACE_MS;
  return { state: starting ? "planning" : "stalled", program: assembleProgram(seed, []) };
}

/** The final frame, or while planning the doc assembled from `partial/catalog/programs/<id>` (status "planning"). Null if neither. */
export async function getCatalogProgram(programId: string): Promise<CatalogProgram | null> {
  return (await readCatalogProgram(programId))?.program ?? null;
}

/** The final syllabus only, one read. Null while it is planning or was never built. */
export async function getFinalSyllabus(courseId: string): Promise<CourseSyllabus | null> {
  if (!isCatalogId(courseId)) return null;
  return getDoc<CourseSyllabus>(catalogKeys.syllabus(courseId));
}

/** A syllabus assembled from the parts written so far, with `planning: true`. */
export function assembleSyllabus(courseId: string, parts: SyllabusPart[], fallbackSlug: string): CourseSyllabus {
  const head = parts.find((part): part is Extract<SyllabusPart, { kind: "head" }> => part?.kind === "head");
  const shape = SYLLABUS_SHAPE.degree;
  return {
    version: 1,
    rootMapId: courseId,
    planning: true,
    depth: "degree",
    courseSlug: head?.courseSlug ?? fallbackSlug,
    ...(head?.level && { level: head.level }),
    outcomes: head?.outcomes ?? [],
    units: parts.flatMap((part) => (part?.kind === "unit" && part.unit ? [{ ...part.unit, built: false }] : [])),
    assessment: head?.assessment ?? { unitTests: shape.unitTests, finalQuestions: shape.finalQuestions },
  };
}

/** The course's syllabus: final, planning (from the partial doc, `planning: true`), or idle. No model call. */
export async function readCatalogSyllabus(courseId: string): Promise<CatalogSyllabusRead> {
  if (!isCatalogId(courseId)) return { state: "idle" };
  const read = await readOnce<CourseSyllabus, SyllabusPart>(catalogKeys.syllabus(courseId));
  if (read.state === "ready") return { state: "ready", syllabus: read.value };
  if (read.state === "idle") return { state: "idle" };
  const hasHead = read.parts.some((part) => part?.kind === "head");
  const fallbackSlug = hasHead ? "" : ((await getCatalogCourse(courseId))?.homeSlug ?? "course");
  return { state: "planning", syllabus: assembleSyllabus(courseId, read.parts, fallbackSlug) };
}
