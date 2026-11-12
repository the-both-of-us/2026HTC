import type { CourseView, ProgramPlanning, ProgramView } from "../types";

/** How often the program page asks again while courses are being planned. */
export const PROGRAM_POLL_MS = 1500;

/**
 * Whether the program page should keep polling `GET /api/programs/[id]`: a live claim is writing
 * course lines, or the frame is final but some course is not registered yet (no Start button).
 * A stalled program has no writer, so polling would never end: the page offers "Try again".
 */
export function needsProgramPoll(program: Pick<ProgramView, "planning" | "courses">): boolean {
  const state = program.planning?.state;
  if (state === "stalled") return false;
  if (state === "planning") return true;
  return program.courses.some((course) => course.startable === false);
}

/** "Planning courses: 12 of 40". */
export function planningLine(planning: Pick<ProgramPlanning, "planned" | "expected">): string {
  return `Planning courses: ${planning.planned} of ${planning.expected}`;
}

/** A course whose Start button is off: its catalog entry is not written yet. */
export const isRegistering = (course: Pick<CourseView, "startable">): boolean => course.startable === false;
