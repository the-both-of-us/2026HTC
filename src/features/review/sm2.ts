/**
 * SM-2 spaced repetition, as plain functions. No store, no clock: `now` is always passed in.
 * The exact rules are in README.md, and sm2.test.ts checks them as a table.
 */
import type { Grade, ReviewCard } from "./types";

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
/** "Again" brings the card back this soon, the same session if the learner keeps going. */
export const AGAIN_DELAY_MS = 10 * 60 * 1000;
/** No card waits longer than a year. */
export const MAX_INTERVAL_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/** SM-2's quality score for each answer. */
export const QUALITY: Record<Grade, number> = { again: 0, hard: 3, good: 4, easy: 5 };

/** The parts of a card's state the schedule depends on. A new card has none yet. */
export type Schedule = Pick<ReviewCard, "intervalDays" | "ease" | "repetitions" | "lapses">;

export const NEW_SCHEDULE: Schedule = { intervalDays: 0, ease: START_EASE, repetitions: 0, lapses: 0 };

/** Two decimals, so repeated small changes never drift into 2.3599999. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), never below 1.3. "Again" is EF - 0.2. */
export function nextEase(ease: number, grade: Grade): number {
  if (grade === "again") return round2(Math.max(MIN_EASE, ease - 0.2));
  const miss = 5 - QUALITY[grade];
  return round2(Math.max(MIN_EASE, ease + (0.1 - miss * (0.08 + miss * 0.02))));
}

/** Days until the next review for a grade, given the state before it. 0 means "in 10 minutes". */
export function nextIntervalDays(before: Schedule, grade: Grade): number {
  if (grade === "again") return 0;
  const ease = nextEase(before.ease, grade);
  const n = before.repetitions;
  const previous = Math.max(1, before.intervalDays);

  // Good: 1 day, then 6 days, then the last interval times the (updated) ease.
  const good = n === 0 ? 1 : n === 1 ? 6 : Math.round(previous * ease);

  let days: number;
  if (grade === "good") days = good;
  // Easy: Good's interval with a 1.3 bonus, and always at least a day longer than Good.
  else if (grade === "easy") days = Math.max(good + 1, Math.round(good * 1.3));
  // Hard: the last interval times 1.2 instead of the ease, and always at least a day longer.
  else days = n === 0 ? 1 : Math.max(previous + 1, Math.round(previous * 1.2));

  return Math.min(MAX_INTERVAL_DAYS, days);
}

/** The new schedule after one answer. */
export function applyGrade(before: Schedule, grade: Grade): Schedule {
  const ease = nextEase(before.ease, grade);
  const intervalDays = nextIntervalDays(before, grade);
  if (grade === "again") {
    // A lapse is forgetting a card that had been learned. Missing a new card is not one.
    return { intervalDays, ease, repetitions: 0, lapses: before.lapses + (before.repetitions > 0 ? 1 : 0) };
  }
  return { intervalDays, ease, repetitions: before.repetitions + 1, lapses: before.lapses };
}

/** When a card graded now comes back. */
export function dueAtFor(intervalDays: number, now: Date): string {
  const delay = intervalDays === 0 ? AGAIN_DELAY_MS : intervalDays * DAY_MS;
  return new Date(now.getTime() + delay).toISOString();
}

/** Grades a card (null means new) and returns its full new state. */
export function reviewCard(
  previous: ReviewCard | null,
  identity: Pick<ReviewCard, "cardId" | "mapId" | "nodeId">,
  grade: Grade,
  now: Date,
): ReviewCard {
  const before: Schedule = previous ?? NEW_SCHEDULE;
  const after = applyGrade(before, grade);
  return { ...identity, ...after, dueAt: dueAtFor(after.intervalDays, now), lastReviewedAt: now.toISOString() };
}

/** What each grade would give, for the labels under the buttons. */
export function previewIntervals(previous: Schedule | null): Record<Grade, number> {
  const before = previous ?? NEW_SCHEDULE;
  return {
    again: nextIntervalDays(before, "again"),
    hard: nextIntervalDays(before, "hard"),
    good: nextIntervalDays(before, "good"),
    easy: nextIntervalDays(before, "easy"),
  };
}

/** "10 min", "1 day", "6 days", "2 months", "1 year". */
export function formatInterval(days: number): string {
  if (days <= 0) return "10 min";
  if (days === 1) return "1 day";
  if (days < 31) return `${days} days`;
  if (days < MAX_INTERVAL_DAYS) {
    const months = Math.round(days / 30);
    return months === 1 ? "1 month" : `${months} months`;
  }
  return "1 year";
}
