import { createHash, createHmac } from "node:crypto";
import { computeScore, isUsableQuote } from "@/features/teachback";
import { isFullCatch } from "./redact";
import type { ProofCheckResult, ProofSnapshot } from "./types";

/**
 * The one exact text form of a snapshot: keys sorted, no spaces. The same data always
 * gives the same text, whatever order its fields were stored in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = sortKeys(record[key]);
  return sorted;
}

/** The SHA-256 fingerprint of a snapshot, as lowercase hex. */
export function hashSnapshot(snapshot: ProofSnapshot): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

/**
 * A signature over the fingerprint, made with a key that lives only in the server's
 * environment, never in the store. Anyone who can edit the store can recompute a plain
 * hash, but can't make this without the key. Null when this server has no key.
 */
export function sealFor(hash: string): string | null {
  const secret = process.env.PROOF_SEAL_SECRET;
  return secret ? createHmac("sha256", secret).update(hash, "utf8").digest("hex") : null;
}

/**
 * Re-checks a stored record from scratch: the fingerprint, the seal, every quote against
 * the person's own text, and every score against the formula. No AI is involved.
 */
export function checkSnapshot(snapshot: ProofSnapshot, storedHash: string, storedSeal: string | null = null): ProofCheckResult {
  const recomputedHash = hashSnapshot(snapshot);
  const quotes = { verified: 0, total: 0 };
  const scores = { matching: 0, total: snapshot.skills.length };

  for (const skill of snapshot.skills) {
    const met = skill.checkpoints.filter((result) => result.met);
    // A counts-only "catch" skill keeps no quotes (they would give the answers away).
    if (!(skill.catch && !isFullCatch(skill.catch))) {
      quotes.total += met.length;
      quotes.verified += met.filter(
        (result) => result.quote !== null && isUsableQuote(result.quote, skill.explanation),
      ).length;
    }

    const expected = computeScore(met.length, skill.checkpoints.length, skill.factualErrors.length);
    if (expected === skill.score) scores.matching += 1;
  }

  // A record with no seal fails on a server with a key, so stripping the seal hides nothing.
  const expectedSeal = sealFor(recomputedHash);
  const sealMatches = expectedSeal === null ? null : storedSeal === expectedSeal;

  return { hashMatches: recomputedHash === storedHash, sealMatches, storedHash, recomputedHash, quotes, scores };
}
