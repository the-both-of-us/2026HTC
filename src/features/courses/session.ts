import { isAuthConfigured } from "@/features/auth";
import { getSession } from "@/shared/identity";
import { CoursesError } from "./errors";
import { isUuid } from "@/shared/ids";

/**
 * The one place that decides who may publish, like and start a course.
 *
 * With Auth0 set up, publishing and liking need a signed-in session, so a name stands
 * behind every course and a like counts once per person. Everything else, including
 * starting a course and making your own course private, stays open to guests: there is
 * never a login wall. Without Auth0 (tests, offline development), guests may do all of it.
 */


const WHO_ARE_YOU = "We could not tell who you are. Please refresh the page and try again.";
export const SIGN_IN_TO_PUBLISH = "Sign in to publish a course, so your name shows on it.";
export const SIGN_IN_TO_LIKE = "Sign in to like courses.";

/** The user id becomes part of a store key, so it must look like one of ours. */
function assertUserId(userId: string): void {
  if (!isUuid(userId)) throw new CoursesError(WHO_ARE_YOU, 400);
}

/** Throws a 401 sentence unless this request is signed in as `userId`. A no-op without Auth0. */
async function requireSignedIn(userId: string, message: string): Promise<void> {
  if (!isAuthConfigured()) return;
  const session = await getSession();
  if (!session.signedIn || session.userId !== userId) throw new CoursesError(message, 401);
}

/** Who may publish their own maps (or programs, with their own sentence): signed in, once Auth0 is set up. */
export async function requirePublisher(userId: string, message = SIGN_IN_TO_PUBLISH): Promise<void> {
  assertUserId(userId);
  await requireSignedIn(userId, message);
}

/** Who may make their own course private: any owner. Taking a course down never needs an account. */
export function requireUnpublisher(userId: string): void {
  assertUserId(userId);
}

/** Who may like or unlike a course: signed in, once Auth0 is set up. */
export async function requireLiker(userId: string): Promise<void> {
  assertUserId(userId);
  await requireSignedIn(userId, SIGN_IN_TO_LIKE);
}

/** Who may start a course (copy it to their own map). Anyone, guests included. */
export function requireLearner(userId: string): void {
  assertUserId(userId);
}

export type ViewerAccess = {
  signedIn: boolean;
  /** True when this viewer must sign in before publishing or liking. */
  signInRequired: boolean;
  /** The viewer's own name, to pre-fill "Name to show". Null for guests. */
  displayName: string | null;
};

/** What the course page needs to know about the viewer. Never their id. */
export async function viewerAccess(): Promise<ViewerAccess> {
  if (!isAuthConfigured()) return { signedIn: false, signInRequired: false, displayName: null };
  const session = await getSession();
  return {
    signedIn: session.signedIn,
    signInRequired: !session.signedIn,
    displayName: session.signedIn ? session.displayName : null,
  };
}
