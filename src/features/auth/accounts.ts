/**
 * Links an Auth0 account to an OryxLearn user id. The first sign-in keeps the visitor's
 * current guest id, so everything they made as a guest is theirs. Later sign-ins, on any
 * device, put that same id back in the cookie. No data is ever copied or moved.
 */
import { createHash, randomUUID } from "node:crypto";
import { getUserId } from "@/shared/identity";
import { claimDoc, deleteDoc, getDoc, putDoc } from "@/shared/store";
import type { IdClaims } from "./oidc";

/** What `accounts/<sha256(sub)>` holds. */
export type AccountDoc = { userId: string; sub: string; createdAt: string };
/** What `account-of/<userId>` holds: the way back, for delete-my-data. */
export type AccountOfDoc = { subHash: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DISPLAY_NAME_LENGTH = 40;
const FALLBACK_NAME = "Learner";

/** The raw Auth0 subject never appears in a store key: keys can show up in listings and logs. */
export function subHash(sub: string): string {
  return createHash("sha256").update(sub).digest("hex");
}

export function accountKey(hash: string): string {
  return `accounts/${hash}`;
}

export function accountOfKey(userId: string): string {
  return `account-of/${userId}`;
}

function isAccountDoc(value: unknown): value is AccountDoc {
  const doc = value as Partial<AccountDoc> | null;
  return typeof doc?.userId === "string" && UUID_PATTERN.test(doc.userId);
}

/**
 * The user id for this Auth0 account, linking it on first sign-in.
 *
 * - Already linked: its saved id, whichever browser this is.
 * - New account: this browser's current id, unless that id already belongs to a different
 *   account. Then it gets a brand new id, so account B never sees account A's courses.
 * - "One id, one account" is atomic, not check-then-write: the way back (`account-of/<id>`)
 *   is claimed with create-if-absent before the forward link, so two accounts signing in
 *   at once with one id can't both get it, and a write that fails halfway still leaves the
 *   id marked as this account's.
 * - Two first sign-ins to one account at once: claimDoc lets exactly one write the forward
 *   link, and the other uses the winner's id.
 */
export async function linkAccount(sub: string): Promise<string> {
  const hash = subHash(sub);
  const key = accountKey(hash);
  const current = await getUserId();

  const existing = await getDoc<unknown>(key);
  if (isAccountDoc(existing)) return finish(existing.userId, hash);

  const { userId: candidate, created } = await reserveId(current, hash);

  const doc: AccountDoc = { userId: candidate, sub, createdAt: new Date().toISOString() };
  if (await claimDoc(key, doc)) return candidate;

  // Someone else linked this account between our read and our claim. Their id wins.
  const winner = await getDoc<unknown>(key);
  if (!isAccountDoc(winner)) throw new Error("The account link vanished during sign-in");
  // Give back the id we reserved, so a guest's own id stays free for a later sign-in.
  if (created && candidate !== winner.userId) await deleteDoc(accountOfKey(candidate));
  return finish(winner.userId, hash);
}

const MAX_RESERVE_ATTEMPTS = 3;

/**
 * Claims `account-of/<id>` for this account: `current` if it is free or already this
 * account's, otherwise a brand new id. `created` says whether this call wrote the claim.
 */
async function reserveId(current: string, hash: string): Promise<{ userId: string; created: boolean }> {
  let candidate = current;
  for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt++) {
    if (await claimDoc(accountOfKey(candidate), { subHash: hash } satisfies AccountOfDoc)) {
      return { userId: candidate, created: true };
    }
    const owner = await getDoc<AccountOfDoc>(accountOfKey(candidate));
    // Left over from an earlier sign-in to this same account that failed halfway.
    if (owner?.subHash === hash) return { userId: candidate, created: false };
    candidate = randomUUID();
  }
  throw new Error("Could not reserve a user id for this account");
}

/** For an account already linked: make sure the way back exists too (it repairs itself). */
async function finish(userId: string, hash: string): Promise<string> {
  await putDoc(accountOfKey(userId), { subHash: hash } satisfies AccountOfDoc);
  return userId;
}

/**
 * Forgets the link between this user id and its Auth0 account: deletes `account-of/<userId>`
 * and the `accounts/<hash>` it points to. For delete-my-data. Signing in again afterwards
 * links the account afresh, to whatever id the browser has then.
 */
export async function forgetAccount(userId: string): Promise<void> {
  if (!UUID_PATTERN.test(userId)) return;
  const reverse = await getDoc<AccountOfDoc>(accountOfKey(userId));
  if (typeof reverse?.subHash === "string" && /^[0-9a-f]{64}$/.test(reverse.subHash)) {
    const account = await getDoc<unknown>(accountKey(reverse.subHash));
    // Only delete the forward link if it still points at this user.
    if (!isAccountDoc(account) || account.userId === userId) await deleteDoc(accountKey(reverse.subHash));
  }
  await deleteDoc(accountOfKey(userId));
}

/** Strips control and format characters, collapses whitespace, and trims to 40 characters. */
function cleanName(value: string | undefined): string {
  if (!value) return "";
  // An email address is never shown: keep only the part before the @.
  const withoutDomain = value.includes("@") ? value.slice(0, value.indexOf("@")) : value;
  const cleaned = withoutDomain
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(cleaned).slice(0, MAX_DISPLAY_NAME_LENGTH).join("").trim();
}

/** The name to show: name, then nickname, then the email's local part, then "Learner". */
export function displayNameFrom(claims: Pick<IdClaims, "name" | "nickname" | "email">): string {
  for (const candidate of [claims.name, claims.nickname, claims.email]) {
    const name = cleanName(candidate);
    if (name) return name;
  }
  return FALLBACK_NAME;
}
