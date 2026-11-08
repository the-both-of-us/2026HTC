import { createHash, timingSafeEqual } from "node:crypto";
import { checkServerValue, signServerValue } from "@/shared/identity";

/** The admin cookie: `<expiresAt ms>.<signature>`, httpOnly, for 8 hours. */
export const ADMIN_COOKIE = "pf_admin";
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;

/** At most this many wrong passcodes per address in a window, then every try is refused until it ends. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

const sha256 = (text: string) => createHash("sha256").update(text).digest();

/** The passcode comes only from the environment, never from the repo. No passcode means no admin page. */
function passcode(): string | null {
  const value = process.env.ADMIN_PASSCODE?.trim();
  return value ? value : null;
}

export function isAdminConfigured(): boolean {
  return passcode() !== null;
}

/** Constant time: both sides are hashed first, so their lengths match and reveal nothing. */
export function passcodeMatches(given: string): boolean {
  const expected = passcode();
  if (!expected || typeof given !== "string" || given.length > 200) return false;
  return timingSafeEqual(sha256(given.trim()), sha256(expected));
}

/**
 * The signed value also covers a hash of the passcode, so changing ADMIN_PASSCODE signs
 * everyone out at once.
 */
function signedPart(expiresAt: number): string {
  return `${expiresAt}:${sha256(passcode() ?? "").toString("hex").slice(0, 16)}`;
}

export function makeAdminToken(now = Date.now()): string | null {
  if (!isAdminConfigured()) return null;
  const expiresAt = now + ADMIN_SESSION_MS;
  const signature = signServerValue("admin", signedPart(expiresAt));
  return signature ? `${expiresAt}.${signature}` : null;
}

export function isAdminToken(token: string | undefined, now = Date.now()): boolean {
  if (!token || !isAdminConfigured()) return false;
  const dot = token.indexOf(".");
  const expiresAt = Number(token.slice(0, dot));
  if (dot < 1 || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  return checkServerValue("admin", signedPart(expiresAt), token.slice(dot + 1));
}

// Per server instance, which is enough to make guessing slow; the passcode is the real lock.
const failures = new Map<string, number[]>();

/** True when this address has used up its wrong guesses for now. */
export function isLockedOut(address: string, now = Date.now()): boolean {
  const recent = (failures.get(address) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  failures.set(address, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(address: string, now = Date.now()): void {
  const recent = (failures.get(address) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  recent.push(now);
  failures.set(address, recent);
  // Keeps the map from growing without bound under a spray of addresses.
  if (failures.size > 5_000) failures.delete(failures.keys().next().value as string);
}

/** For tests. */
export function resetFailures(): void {
  failures.clear();
}
