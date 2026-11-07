/** A problem we can explain to the user. The message is safe to show them. */
export class CoursesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CoursesError";
  }
}

/**
 * The answer for a missing course, and for a private one to anyone but its owner, so nobody
 * can tell a private course exists.
 */
export const COURSE_NOT_FOUND =
  "We could not find that course. It may have been made private, or the link is incomplete.";
