import { HttpError } from "@/shared/http";

/** A problem we can explain to the user. The message is safe to show them. */
export class CoursesError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "CoursesError";
  }
}

/**
 * The answer for a missing course, and for a private one to anyone but its owner, so nobody
 * can tell a private course exists.
 */
export const COURSE_NOT_FOUND =
  "We could not find that course. It may have been made private, or the link is incomplete.";
