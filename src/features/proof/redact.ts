import type { CatchRecord } from "@/shared/types";
import type { ProofCatch, ProofSkill, ProofSnapshot } from "./types";

/** A full round has the sentences. The counts-only form does not. */
export function isFullCatch(record: ProofCatch | CatchRecord): record is CatchRecord {
  return "sentences" in record;
}

/** Counts for a "Catch the mistake" skill, from either form of the record. */
export function catchCounts(record: ProofCatch | CatchRecord): ProofCatch {
  if (!isFullCatch(record)) return record;
  const planted = new Set(record.planted.map((item) => item.sentence));
  return {
    plantedCount: record.planted.length,
    caughtCount: record.picks.filter((pick) => pick.fixed).length,
    wrongTaps: record.picks.filter((pick) => !planted.has(pick.sentence)).length,
  };
}

/**
 * Takes the answers out of a "Catch the mistake" skill. Its round is shared by every copy of a
 * course, so a public page must not show the planted sentences, their numbers, the reasons, or
 * any written corrections (rounds before Nov 9 had them). What is left still scores the same: one
 * checkpoint per planted mistake, met when it was caught, and one factual error per wrong tap.
 * Skills in any other format come back untouched. Safe to apply twice.
 */
export function redactSkill(skill: ProofSkill): ProofSkill {
  if (!skill.catch) return skill;
  const counts = catchCounts(skill.catch);
  return {
    ...skill,
    explanation: "",
    checkpoints: skill.checkpoints.map((result, index) => ({ checkpoint: `Planted mistake ${index + 1}`, met: result.met, quote: null })),
    factualErrors: skill.factualErrors.map(() => "Marked a correct sentence as a mistake."),
    catch: counts,
  };
}

/** What the public may see and what the verify route sends. Old records are redacted here, not rewritten. */
export function toPublicSnapshot(snapshot: ProofSnapshot): ProofSnapshot {
  if (!snapshot.skills.some((skill) => skill.catch)) return snapshot;
  return { ...snapshot, skills: snapshot.skills.map(redactSkill) };
}
