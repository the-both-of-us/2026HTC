import { createHash } from "node:crypto";
import { computeScore, quoteIsInText } from "@/features/teachback";
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
 * Re-checks a stored record from scratch: the fingerprint, every quote against the
 * person's own text, and every score against the formula. No AI is involved.
 */
export function checkSnapshot(snapshot: ProofSnapshot, storedHash: string): ProofCheckResult {
  const recomputedHash = hashSnapshot(snapshot);
  const quotes = { verified: 0, total: 0 };
  const scores = { matching: 0, total: snapshot.skills.length };

  for (const skill of snapshot.skills) {
    const met = skill.checkpoints.filter((result) => result.met);
    quotes.total += met.length;
    quotes.verified += met.filter(
      (result) => result.quote !== null && quoteIsInText(result.quote, skill.explanation),
    ).length;

    const expected = computeScore(met.length, skill.checkpoints.length, skill.factualErrors.length);
    if (expected === skill.score) scores.matching += 1;
  }

  return { hashMatches: recomputedHash === storedHash, storedHash, recomputedHash, quotes, scores };
}
