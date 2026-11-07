import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

/**
 * The anonymous user. There is no login: a random id in a cookie is the identity.
 */

const COOKIE_NAME = "pf_uid";
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the id in the cookie, or null if there is no valid one. Read-only, so
 * it is safe anywhere on the server, including while rendering a page.
 *
 * The id ends up inside store keys, so anything that is not a UUID is ignored.
 */
export async function readUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return value && UUID_PATTERN.test(value) ? value : null;
}

/**
 * Returns the current user's id, creating the cookie if needed.
 *
 * Call it in a Route Handler or Server Function. Next.js cannot set a cookie
 * while rendering a page, so a page should call readUserId instead.
 */
export async function getUserId(): Promise<string> {
  const existing = await readUserId();
  if (existing) return existing;

  const id = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_IN_SECONDS,
  });
  return id;
}
