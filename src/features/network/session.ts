import { isAuthConfigured } from "@/features/auth";
import { getSession } from "@/shared/identity";
import { NetworkError, SIGN_IN_TO_JOIN } from "./errors";

/**
 * The one place that decides who may join the network.
 *
 * With Auth0 set up, joining or editing a profile needs a signed-in session, so a real
 * account stands behind every name. Leaving never does: anyone can take their profile down.
 * Without Auth0 (tests, offline development), guests may join.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHO_ARE_YOU = "We could not tell who you are. Please refresh the page and try again.";

/** True for ids identity hands out. Demo profiles use ids that are not UUIDs, so nobody can act as them. */
export function isUserId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The user id becomes part of a store key, so it must look like one of ours. */
export function assertUserId(userId: string): void {
  if (!isUserId(userId)) throw new NetworkError(WHO_ARE_YOU, 400);
}

/** Who may join or edit their profile: signed in as this user, once Auth0 is set up. */
export async function requireJoiner(userId: string): Promise<void> {
  assertUserId(userId);
  if (!isAuthConfigured()) return;
  const session = await getSession();
  if (!session.signedIn || session.userId !== userId) throw new NetworkError(SIGN_IN_TO_JOIN, 401);
}

export type ViewerAccess = {
  signedIn: boolean;
  /** True when this viewer must sign in before joining. */
  signInRequired: boolean;
  /** The viewer's own name, to pre-fill the form. Null for guests. */
  displayName: string | null;
};

/** What the page needs to know about the viewer. Never their id. */
export async function viewerAccess(): Promise<ViewerAccess> {
  if (!isAuthConfigured()) return { signedIn: false, signInRequired: false, displayName: null };
  const session = await getSession();
  return {
    signedIn: session.signedIn,
    signInRequired: !session.signedIn,
    displayName: session.signedIn ? session.displayName : null,
  };
}
