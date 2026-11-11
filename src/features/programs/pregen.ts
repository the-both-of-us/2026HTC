import { after } from "next/server";
import { getCatalogCourse, getCatalogProgram, getFinalSyllabus } from "@/features/catalog";
import { ensureLesson } from "@/features/lessons";
import { getSkillMap, syncCourseMap } from "@/features/skill-map";
import type { SkillNode } from "@/shared/types";
import { ensureCourseBuilt, ensureProgramPlanned } from "./build";

/*
 * Background work after a response, and pre-generation ahead of the learner. Only these
 * `schedule*` wrappers call `after()`; the work functions they run are plain async functions
 * (build.ts), so the offline script can await them. Each step skips content that is ready or
 * running, and starts only when its call fits the time left before the deadline.
 */

/** A route's maxDuration is 120 s; background work stops 8 s short of it. */
export const ROUTE_BUDGET_MS = 112_000;
/** Pre-gen rule 1: course 1's syllabus starts after the frame only with this much time left. */
export const FIRST_COURSE_MIN_MS = 70_000;

/** Pre-gen rule 2: unit 1's first lesson starts only with this much time left. */
export const FIRST_LESSON_MIN_MS = 30_000;

/** The deadline for work started by a request that began at `start`. */
export const deadlineFrom = (start: number = Date.now()) => start + ROUTE_BUDGET_MS;

const reason = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");

/**
 * Plans the catalog program's frame, then (rule 1) course 1's syllabus and unit 1 if at least 70 s
 * remain. Never throws: a failure leaves the program "stalled" and the page offers Try again.
 */
export async function runProgramPlanning(programId: string, deadline: number): Promise<void> {
  try {
    const result = await ensureProgramPlanned(programId, { deadline });
    if (result !== "built" || deadline - Date.now() < FIRST_COURSE_MIN_MS) return;
    const first = (await getCatalogProgram(programId))?.courses.find((course) => course.courseId);
    if (first?.courseId) await runCourseBuild(first.courseId, deadline);
  } catch (error) {
    console.warn(`[programs] planning ${programId} failed: ${reason(error)}`);
  }
}

export function scheduleProgramPlanning(programId: string, deadline: number): void {
  after(() => runProgramPlanning(programId, deadline));
}

/**
 * Builds a catalog course (syllabus, then unit 1) when at least 70 s remain. When a learner map is
 * waiting on it, unit 1 is appended to that map at once (zero calls). Then rule 2: the canonical
 * lesson of unit 1's first topic, under this same deadline (ensureLesson starts it only when its
 * call fits). Never throws.
 */
export async function runCourseBuild(courseId: string, deadline: number, mapId?: string): Promise<void> {
  try {
    if (deadline - Date.now() < FIRST_COURSE_MIN_MS) return;
    const result = await ensureCourseBuilt(courseId, { deadline });
    if (result.unit1?.status !== "ready") return;
    if (mapId) {
      const map = await getSkillMap(mapId);
      if (map?.courseId === courseId) await syncCourseMap(map, deadline);
    }
    await writeFirstLesson(courseId, result.unit1.nodes, deadline);
  } catch (error) {
    console.warn(`[programs] course ${courseId} build failed: ${reason(error)}`);
  }
}

/** Rule 2: the lesson of unit 1's first topic (one with no prerequisites), shared by every learner. */
async function writeFirstLesson(courseId: string, nodes: SkillNode[], deadline: number): Promise<void> {
  const node = nodes.find((candidate) => candidate.prerequisites.length === 0) ?? nodes[0];
  if (!node || deadline - Date.now() < FIRST_LESSON_MIN_MS) return;
  const [course, syllabus] = await Promise.all([getCatalogCourse(courseId), getFinalSyllabus(courseId)]);
  if (!course || !syllabus) return;
  const written = await ensureLesson({
    contentId: courseId,
    node,
    course: { title: course.title, ...(course.audience && { audience: course.audience }), syllabus },
    deadline,
  });
  if (written === "no-time") console.info(`[programs] no time left for the first lesson of ${courseId}`);
}

export function scheduleCourseBuild(courseId: string, deadline: number, mapId?: string): void {
  after(() => runCourseBuild(courseId, deadline, mapId));
}

/**
 * Rule 5: when a course is opened, the next course in program order gets its syllabus (and unit 1)
 * in its own `after()`, so it is ready when the learner gets there. Skipped without a courseId.
 */
export function scheduleNextCourse(courses: { courseId?: string }[], index: number, deadline: number): void {
  const next = courses.slice(index + 1).find((course) => course.courseId);
  if (next?.courseId) scheduleCourseBuild(next.courseId, deadline);
}
