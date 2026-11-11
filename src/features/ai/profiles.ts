/**
 * Wave 2: one model (Claude Haiku 5.5, `ANTHROPIC_MODEL`, default "claude-haiku-5-5") with three
 * thinking profiles, chosen by task, never by the learner. Callers pass `profile`, never a model.
 * Callers may lower `maxTokens` and `totalMs` per call, never raise them past these.
 *
 * Haiku 5.5 (claude-api skill, 2026-11): thinking `{type: "adaptive"}` (on by default) or
 * `{type: "disabled"}` (only at effort high or below); `output_config.effort` defaults to medium,
 * so it is always sent; temperature/top_p/top_k, prefill and `fallbacks` are never sent.
 * Measured (design2.md): a syllabus on plan takes ~50 s and ~13k output tokens incl. thinking.
 */

export type Profile = "plan" | "write" | "check";

export type ProfileSettings = {
  thinking: { type: "adaptive" } | { type: "disabled" };
  effort: "low" | "medium" | "high";
  /** Default and ceiling for `max_tokens` (thinking counts against it). */
  maxTokens: number;
  /** Streams must show their first text within this, or the call fails. */
  firstTextMs: number;
  /** Default and ceiling for the whole call, repair included. */
  totalMs: number;
};

export const PROFILES: Record<Profile, ProfileSettings> = {
  /**
   * Program frames, short plans, syllabi, unit maps, posting and PDF maps. First text comes only
   * after the thinking (~10k tokens): 24 s for a degree frame on Nov 11, but over 45 s on a later
   * real run, which failed the frame. 70 s still leaves 30 s of the 100 s for the lines.
   */
  plan: { thinking: { type: "adaptive" }, effort: "high", maxTokens: 32_000, firstTextMs: 70_000, totalMs: 100_000 },
  /** Lessons, quiz, flashcards, catch rounds, final and unit-test questions. */
  write: { thinking: { type: "adaptive" }, effort: "low", maxTokens: 12_000, firstTextMs: 25_000, totalMs: 60_000 },
  /** Grading, follow-ups, the catalog resolver, feed checks: short calls a learner waits on. */
  check: { thinking: { type: "disabled" }, effort: "low", maxTokens: 2_000, firstTextMs: 10_000, totalMs: 15_000 },
};

/** The model id every call uses. */
export function modelId(): string {
  return process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
}

/** A short name for the model that wrote something, for people: "Claude Haiku". */
export function modelLabel(model: string): string {
  const id = model.toLowerCase();
  if (id.includes("haiku")) return "Claude Haiku";
  if (id.includes("sonnet")) return "Claude Sonnet";
  if (id.includes("opus")) return "Claude Opus";
  return model;
}
