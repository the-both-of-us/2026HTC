/** Small, plain helpers for the network screen, kept out of the components so they can be tested. */
import type { NetworkView } from "../types";

export const DEMO_NOTE = "Demo profiles are made up so you can see how matching works. They are not real people.";
export const SIGN_IN_LEAD = "Sign in";
export const SIGN_IN_REST = " to join the network, so people know it's really you.";
/** How many proven skills a card shows before "Show all". */
export const SKILLS_SHOWN = 6;

/** The sign-in link that comes back to /people. A plain URL, so it works without JavaScript. */
export const LOGIN_HREF = `/api/auth/login?${new URLSearchParams({ returnTo: "/people" })}`;

/** "1 skill", "3 skills". */
export function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Where a contact link goes, for its visible text: "linkedin.com". Null if it is not an https link. */
export function contactHost(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when any profile on the page is a demo, so the page must say they are made up. */
export function hasDemo(view: NetworkView): boolean {
  return [...view.mentors, ...view.peers, ...view.everyone].some((match) => match.profile.isDemo);
}

/** True when the viewer can be matched: they joined, or they have a map. */
export function canMatch(view: NetworkView): boolean {
  return view.me !== null || view.viewerHasMaps;
}

/**
 * True when anyone has a skill in common with the viewer, in any section. Someone who only
 * proved the same skill as the viewer is listed under "Everyone else", but still matches.
 */
export function hasAnyMatch(view: NetworkView): boolean {
  return [...view.mentors, ...view.peers, ...view.everyone].some((match) => match.score > 0);
}

/** What the last section says about the people in it. Always true of every one of them. */
export function everyoneDescription(view: NetworkView): string {
  return canMatch(view)
    ? "Not learning the same skills as you right now."
    : "Build a map or join to see who matches you. Until then, here is everyone.";
}

/** The last section's heading: "else" once people were already shown above it. */
export function everyoneHeading(view: NetworkView): string {
  return view.mentors.length + view.peers.length > 0 ? "Everyone else in the network" : "Everyone in the network";
}

/** Total people in the network, other than the viewer. */
export function peopleCount(view: NetworkView): number {
  return view.mentors.length + view.peers.length + view.everyone.length;
}
