import type { CourseView, HoursFigure } from "../types";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "4.5 h planned". The numbers come from the server, computed in code; a null figure says there is nothing yet. */
export function formatHours(figure: HoursFigure): string {
  if (figure.hours === null) return `none ${figure.label} yet`;
  const range = figure.hoursMax !== undefined && figure.hoursMax !== figure.hours ? `${figure.hours} to ${figure.hoursMax}` : `${figure.hours}`;
  return `${range} h ${figure.label}`;
}

export type TermGroup = { key: string; label: string; year: number | null; term: number | null; courses: CourseView[] };

/** Groups a degree program's courses by year and term, in order. Courses with no year go last. */
export function groupByTerm(courses: CourseView[]): TermGroup[] {
  const groups = new Map<string, TermGroup>();
  for (const course of courses) {
    const year = course.year ?? null;
    const term = course.term ?? null;
    const key = year && term ? `y${year}t${term}` : "other";
    let group = groups.get(key);
    if (!group) {
      group = { key, label: year && term ? `Year ${year}, term ${term}` : "Other courses", year, term, courses: [] };
      groups.set(key, group);
    }
    group.courses.push(course);
  }
  return [...groups.values()].sort((a, b) => (a.year ?? 99) * 10 + (a.term ?? 0) - ((b.year ?? 99) * 10 + (b.term ?? 0)));
}

/** Topics a course will have: what the syllabus plans, else what is built, else unknown. */
export const topicDenominator = (course: CourseView): number | null => course.plannedTopics ?? course.total;

/** One progress line for a term: topics proved out of those planned, and courses finished. */
export function termProgressLine(courses: CourseView[]): string {
  const proved = courses.reduce((sum, c) => sum + c.proven, 0);
  const done = courses.filter((c) => c.badge).length;
  const known = courses.every((c) => topicDenominator(c) !== null);
  const total = known ? courses.reduce((sum, c) => sum + (topicDenominator(c) ?? 0), 0) : null;
  const topics = total !== null ? `${proved} of ${plural(total, "topic")} proved` : `${plural(proved, "topic")} proved`;
  return `${topics} · ${done} of ${plural(courses.length, "course")} finished`;
}
