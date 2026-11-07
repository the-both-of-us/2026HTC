/** Small, plain helpers for the courses screens, kept out of the components so they can be tested. */
import type { LikeResult, PublicCourse } from "../types";

/** "1 skill", "3 skills". */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export const skillsLabel = (count: number) => countLabel(count, "skill", "skills");
export const likesLabel = (count: number) => countLabel(count, "like", "likes");

/** The polite announcement under the search field. */
export function resultsSummary(count: number, query: string): string {
  const q = query.trim();
  if (count === 0) return q ? `No courses match "${q}".` : "No courses have been shared yet.";
  const courses = countLabel(count, "course", "courses");
  return q ? `${courses} match "${q}".` : `${courses}.`;
}

/** True when any shown course is a sample, so the page must say where samples come from. */
export function hasSample(courses: PublicCourse[]): boolean {
  return courses.some((course) => course.isSample);
}

/** The like state to show straight away, before the server answers. Never below zero. */
export function optimisticLike(current: LikeResult, liked: boolean): LikeResult {
  if (current.liked === liked) return current;
  return { liked, likeCount: Math.max(0, current.likeCount + (liked ? 1 : -1)) };
}

export function courseHref(mapId: string): string {
  return `/courses/${encodeURIComponent(mapId)}`;
}

export function mapHref(mapId: string): string {
  return `/map/${encodeURIComponent(mapId)}`;
}

/** How long to wait after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 250;

export const SAMPLE_NOTE =
  "Sample courses come from sample job postings written for this demo. They are not real job ads.";
