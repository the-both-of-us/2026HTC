import type { CourseState } from "./types";

/** A course opens once half of each course it requires is proved. Half, so the path keeps moving. */
export function proofsToUnlock(total: number): number {
  return Math.ceil(total / 2);
}

type CourseLink = { slug: string; title: string; requires: string[] };
type CourseProgress = { proven: number; total: number };
type Blocker = { title: string; needed: number | null };

/**
 * Works out each course's state from what is proved so far. A required course that
 * is not built yet blocks with `needed: null`, meaning "start it first".
 */
export function courseStates(
  courses: CourseLink[],
  progress: Record<string, CourseProgress | undefined>,
): Record<string, { state: CourseState; blockers: Blocker[] }> {
  const result: ReturnType<typeof courseStates> = {};
  for (const course of courses) {
    const blockers = course.requires.flatMap((slug): Blocker[] => {
      const required = courses.find((other) => other.slug === slug);
      if (!required) return [];
      const done = progress[slug];
      if (!done) return [{ title: required.title, needed: null }];
      const needed = proofsToUnlock(done.total) - done.proven;
      return needed > 0 ? [{ title: required.title, needed }] : [];
    });
    const own = progress[course.slug];
    const state: CourseState =
      blockers.length > 0 ? "locked" : own && own.total > 0 && own.proven >= own.total ? "done" : "open";
    result[course.slug] = { state, blockers };
  }
  return result;
}
