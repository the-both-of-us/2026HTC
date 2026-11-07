/**
 * The sign-in transaction: what the callback needs to check that the answer from Auth0 is
 * the reply to a sign-in this browser started. It lives in one short-lived cookie,
 * `pf_auth_tx`, signed with AUTH0_SECRET as `<payload>.<signature>`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { safeReturnTo } from "./returnTo";

export const TX_COOKIE = "pf_auth_tx";
export const TX_MAX_AGE_SECONDS = 600;
/** The cookie is only sent to the auth routes. */
const TX_PATH = "/api/auth";
/** A little clock drift between servers is fine; a cookie from the future is not. */
const CLOCK_SKEW_MS = 60_000;

export type Transaction = {
  state: string;
  nonce: string;
  /** The PKCE code verifier. Only its hash goes to Auth0 at the start. */
  verifier: string;
  returnTo: string;
  /** Milliseconds since the epoch. */
  createdAt: number;
};

function signature(payload: string, secret: string): string {
  // The cookie name is part of what is signed, so no other signed value can pass as this one.
  return createHmac("sha256", secret).update(`${TX_COOKIE}:${payload}`).digest("base64url");
}

/** Constant-time string comparison. Different lengths are simply unequal. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Encodes and signs a transaction. */
export function sealTransaction(tx: Transaction, secret: string): string {
  const payload = Buffer.from(JSON.stringify(tx)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

function isTransaction(value: unknown): value is Transaction {
  const tx = value as Partial<Transaction> | null;
  return (
    typeof tx?.state === "string" &&
    typeof tx.nonce === "string" &&
    typeof tx.verifier === "string" &&
    typeof tx.returnTo === "string" &&
    typeof tx.createdAt === "number" &&
    Number.isFinite(tx.createdAt)
  );
}

/** The transaction, or null if the value is missing, tampered with, malformed or expired. */
export function openTransaction(sealed: string | undefined, secret: string, now = Date.now()): Transaction | null {
  if (!sealed) return null;
  const dot = sealed.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = sealed.slice(0, dot);
  if (!safeEqual(sealed.slice(dot + 1), signature(payload, secret))) return null;

  let tx: unknown;
  try {
    tx = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isTransaction(tx)) return null;
  const age = now - tx.createdAt;
  if (age > TX_MAX_AGE_SECONDS * 1000 || age < -CLOCK_SKEW_MS) return null;
  return { ...tx, returnTo: safeReturnTo(tx.returnTo) };
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: TX_PATH,
    maxAge,
  } as const;
}

/** Saves the transaction for the callback. Call in a Route Handler. */
export async function saveTransaction(tx: Transaction, secret: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(TX_COOKIE, sealTransaction(tx, secret), cookieOptions(TX_MAX_AGE_SECONDS));
}

/** Reads the transaction and deletes the cookie, so it can be used once at most. */
export async function takeTransaction(secret: string | null): Promise<Transaction | null> {
  const cookieStore = await cookies();
  const sealed = cookieStore.get(TX_COOKIE)?.value;
  // Expire it on the same path it was set on, whatever happens next.
  cookieStore.set(TX_COOKIE, "", cookieOptions(0));
  return secret ? openTransaction(sealed, secret) : null;
}
