import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { HttpError } from "./http";

/**
 * Who the current user is. Everyone starts as a guest: a random id in a cookie.
 * Signing in is optional and keeps that same id.
 *
 * Both cookies are signed, as `<value>.<signature>`, so a pasted or edited value
 * counts as no cookie. The user id is an owner id: never send it to a browser.
 */

const USER_COOKIE = "pf_uid";
/** Present once someone has signed in. It holds their display name and user id. */
const ACCOUNT_COOKIE = "pf_account";
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DISPLAY_NAME_LENGTH = 100;
/** For development and tests only. In production a missing secret is an error. */
const DEV_SECRET = "oryxlearn-development-only-secret";

export type Session = {
  /** Null until a route handler has given this visitor a cookie. */
  userId: string | null;
  signedIn: boolean;
  displayName: string | null;
};

type Account = { userId: string; displayName: string };

function getSecret(): string | null {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV !== "production") return DEV_SECRET;
  console.error("[identity] SESSION_SECRET is not set, so no user can be identified. Set it and restart.");
  return null;
}

/** The cookie's name is part of what gets signed, so one cookie's value can't pass as the other's. */
function sign(cookieName: string, value: string, secret: string): string {
  return createHmac("sha256", secret).update(`${cookieName}:${value}`).digest("base64url");
}

/** Returns `<value>.<signature>`, or throws if there is no secret to sign with. */
function seal(cookieName: string, value: string): string {
  const secret = getSecret();
  if (!secret) {
    throw new HttpError("We can't save your work right now because of a problem on our side. Please try again later.", 503);
  }
  return `${value}.${sign(cookieName, value, secret)}`;
}

/** Returns the value if its signature is right, and otherwise null. */
function unseal(cookieName: string, sealed: string | undefined): string | null {
  const dot = sealed?.lastIndexOf(".") ?? -1;
  if (!sealed || dot < 0) return null;

  const secret = getSecret();
  if (!secret) return null;

  const value = sealed.slice(0, dot);
  const given = Buffer.from(sealed.slice(dot + 1));
  const expected = Buffer.from(sign(cookieName, value, secret));
  // timingSafeEqual throws on different lengths, and a length reveals nothing here.
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: ONE_YEAR_IN_SECONDS,
} as const;

async function setUserCookie(userId: string): Promise<void> {
  const sealed = seal(USER_COOKIE, userId);
  const cookieStore = await cookies();
  cookieStore.set(USER_COOKIE, sealed, COOKIE_OPTIONS);
}

/**
 * Returns the id in the cookie, or null if there is no valid one. Read-only, so
 * it is safe anywhere on the server, including while rendering a page.
 *
 * The id ends up inside store keys, so anything that is not a UUID is ignored.
 */
export async function readUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = unseal(USER_COOKIE, cookieStore.get(USER_COOKIE)?.value);
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
  await setUserCookie(id);
  return id;
}

/**
 * Who is here and whether they signed in. Read-only, so it is safe while rendering.
 * Give a client component only displayName and signedIn, never userId.
 */
export async function getSession(): Promise<Session> {
  const userId = await readUserId();
  const cookieStore = await cookies();
  const account = parseAccount(unseal(ACCOUNT_COOKIE, cookieStore.get(ACCOUNT_COOKIE)?.value));

  // The account cookie only counts alongside the user id it was issued with.
  if (!userId || account?.userId !== userId) return { userId, signedIn: false, displayName: null };
  return { userId, signedIn: true, displayName: account.displayName };
}

/**
 * Call after sign-in, in a Route Handler. The user continues as `userId` on this
 * device, whether that is their guest id or the id saved on their account.
 */
export async function setSessionUser(userId: string, { displayName }: { displayName: string }): Promise<void> {
  if (!UUID_PATTERN.test(userId)) throw new Error("setSessionUser needs a UUID");

  const account: Account = { userId, displayName: displayName.slice(0, MAX_DISPLAY_NAME_LENGTH) };
  const encoded = Buffer.from(JSON.stringify(account)).toString("base64url");
  const sealedAccount = seal(ACCOUNT_COOKIE, encoded);

  await setUserCookie(userId);
  const cookieStore = await cookies();
  cookieStore.set(ACCOUNT_COOKIE, sealedAccount, COOKIE_OPTIONS);
}

/**
 * Signs out, in a Route Handler, and starts a fresh guest. Judges share one laptop,
 * so the next person must not see the last person's private courses.
 */
export async function clearSession(): Promise<string> {
  const id = randomUUID();
  await setUserCookie(id);
  const cookieStore = await cookies();
  cookieStore.delete(ACCOUNT_COOKIE);
  return id;
}

function parseAccount(encoded: string | null): Account | null {
  if (!encoded) return null;
  // The signature was already checked, so this is JSON we wrote ourselves.
  return JSON.parse(Buffer.from(encoded, "base64url").toString()) as Account;
}
