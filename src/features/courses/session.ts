import { CoursesError } from "./errors";

/**
 * The one place that decides who may publish, like and start a course.
 *
 * There is no sign-in yet, so guests may do all three today. When the Auth0 step lands,
 * these functions start requiring a signed-in session (and throw a 401 sentence
 * otherwise). Nothing else in this feature needs to change.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WHO_ARE_YOU = "We could not tell who you are. Please refresh the page and try again.";

/** The user id becomes part of a store key, so it must look like one of ours. */
function assertUserId(userId: string): void {
  if (!UUID_PATTERN.test(userId)) throw new CoursesError(WHO_ARE_YOU, 400);
}

/** Who may publish and unpublish their own maps. Guests, until sign-in exists. */
export function requirePublisher(userId: string): void {
  assertUserId(userId);
}

/** Who may like a course. Guests, until sign-in exists. */
export function requireLiker(userId: string): void {
  assertUserId(userId);
}

/** Who may start a course (copy it to their own map). Guests, until sign-in exists. */
export function requireLearner(userId: string): void {
  assertUserId(userId);
}
