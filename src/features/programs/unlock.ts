import type { CourseState } from "./types";

/**
 * A course opens once a quarter of each required course's planned topics is proved: a course
 * plans 32 to 48 topics, so half would hold the next course back for about 20 topics.
 */
export function proofsToUnlock(plannedTopics: number): number {
  return Math.ceil(plannedTopics / 4);
}

type CourseLink = { slug: string; title: string; requires: string[] };
/**
 * - `total`: topics the course is counted against (its planned topics when it has a syllabus,
 *   else its map's topics);
 * - `complete`: set when "done" needs more than every topic proved (every unit built, every unit
 *   test and the course final passed).
 */
type CourseProgress = { proven: number; total: number; complete?: boolean };
type Blocker = { title: string; needed: number | null };

/**
 * Works out each course's state from what is proved so far. A required course that is not built
 * yet blocks with `needed: null`, meaning "start it first". A course already started is never
 * locked again.
 */
export function courseStates(
  courses: CourseLink[],
  progress: Record<string, CourseProgress | undefined>,
): Record<string, { state: CourseState; blockers: Blocker[] }> {
  const result: ReturnType<typeof courseStates> = {};
  for (const course of courses) {
    const own = progress[course.slug];
    const blockers = own
      ? []
      : course.requires.flatMap((slug): Blocker[] => {
          const required = courses.find((other) => other.slug === slug);
          if (!required) return [];
          const done = progress[slug];
          if (!done) return [{ title: required.title, needed: null }];
          const needed = proofsToUnlock(done.total) - done.proven;
          return needed > 0 ? [{ title: required.title, needed }] : [];
        });
    const finished = own !== undefined && (own.complete ?? (own.total > 0 && own.proven >= own.total));
    const state: CourseState = blockers.length > 0 ? "locked" : finished ? "done" : "open";
    result[course.slug] = { state, blockers };
  }
  return result;
}
