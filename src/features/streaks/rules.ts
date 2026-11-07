import { addDays, daysBetween, edmontonDay, weekOf } from "./days";

/** One learner's habit record, stored at streaks/<userId>. Pure rules live here; storage is in streaks.ts. */
export type StreakRecord = {
  /** Days in a row with a proof, counted up to lastDay. */
  current: number;
  best: number;
  /** The Edmonton day of the last proof. */
  lastDay: string | null;
  /** Mondays of the weeks whose one freeze is spent. */
  freezeWeeks: string[];
  /** Sparks: 1 per topic proved, 2 for the topic of the day. They start again each Monday. */
  sparks: { week: string; count: number };
  /** The Edmonton days with a proof, newest last, for the week strip. */
  days: string[];
  /** Topics proved back to back. */
  combo: { count: number; lastAt: string | null };
  /** The last proofs counted, so a retried request never counts twice. */
  countedIds: string[];
  /** Each map's topic of the day, picked once a day and then kept. */
  topicOfTheDay: { day: string; picks: Record<string, string> };
  /** When a fading topic was last relit: "<mapId>/<nodeId>" to an ISO time. */
  relitAt: Record<string, string>;
};

/** What the browser sees. No ids, nothing about other people. */
export type StreakView = {
  count: number;
  best: number;
  doneToday: boolean;
  /** This week's freeze is still there. */
  freezeReady: boolean;
  /** A freeze is holding the streak over a missed day. */
  frozen: boolean;
  sparksThisWeek: number;
  /** 2 or more while a combo is running. */
  combo: number;
  /** Monday to Sunday of this week: true on a day with a proof. */
  week: boolean[];
};

/** What the map shows: the streak, today's topic, and how far each proved topic has faded (0 to 3). */
export type MapHabits = { streak: StreakView; topicOfTheDay: string | null; dim: Record<string, number> };

/** A combo continues if the next topic is proved within this time. */
export const COMBO_WINDOW_MS = 20 * 60 * 1000;
/** Days after which a proved topic dims a step, unless it is relit. */
export const DIM_AFTER_DAYS = [3, 7, 14] as const;
/** Streak lengths worth a small celebration. */
export const MILESTONES = [3, 7, 14, 30, 50, 100];
/** A weekly target for sparks: about two topics a weekday. Reaching it is celebrated once. */
export const WEEKLY_SPARK_GOAL = 10;
const KEEP_COUNTED_IDS = 30;
/** A gap longer than this ends a streak, freezes or not. */
const MAX_MISSED_DAYS = 7;

export function emptyRecord(): StreakRecord {
  return {
    current: 0,
    best: 0,
    lastDay: null,
    freezeWeeks: [],
    sparks: { week: "", count: 0 },
    days: [],
    combo: { count: 0, lastAt: null },
    countedIds: [],
    topicOfTheDay: { day: "", picks: {} },
    relitAt: {},
  };
}

/**
 * The freeze weeks needed to cover the days missed between two proof days, or null if the
 * streak can't be saved. Each missed day needs its own week's freeze, and a week has one.
 */
export function freezesToCover(lastDay: string, today: string, spentWeeks: string[]): string[] | null {
  const missed = daysBetween(lastDay, today) - 1;
  if (missed <= 0) return [];
  if (missed > MAX_MISSED_DAYS) return null;

  const weeks: string[] = [];
  for (let offset = 1; offset <= missed; offset++) {
    const week = weekOf(addDays(lastDay, offset));
    if (spentWeeks.includes(week) || weeks.includes(week)) return null;
    weeks.push(week);
  }
  return weeks;
}

/**
 * Counts one proof (or one relit topic). `id` makes it count once, `double` is the topic of
 * the day. Returns the same record unchanged if this id was already counted.
 */
export function applyProof(record: StreakRecord, at: Date, id: string, double = false): StreakRecord {
  if (record.countedIds.includes(id)) return record;
  const today = edmontonDay(at);

  let current = record.current;
  let freezeWeeks = record.freezeWeeks;
  if (record.lastDay !== today) {
    const freezes = record.lastDay ? freezesToCover(record.lastDay, today, freezeWeeks) : null;
    current = freezes ? current + 1 : 1;
    if (freezes) freezeWeeks = [...freezeWeeks, ...freezes].slice(-8);
  }

  const lastAt = record.combo.lastAt ? Date.parse(record.combo.lastAt) : null;
  const comboRuns = lastAt !== null && at.getTime() - lastAt <= COMBO_WINDOW_MS;
  const week = weekOf(today);
  const sparksSoFar = record.sparks.week === week ? record.sparks.count : 0;

  return {
    ...record,
    current,
    best: Math.max(record.best, current),
    lastDay: today,
    freezeWeeks,
    sparks: { week, count: sparksSoFar + (double ? 2 : 1) },
    days: record.days.includes(today) ? record.days : [...record.days, today].slice(-14),
    combo: { count: comboRuns ? record.combo.count + 1 : 1, lastAt: at.toISOString() },
    countedIds: [...record.countedIds, id].slice(-KEEP_COUNTED_IDS),
  };
}

/** The streak as it stands now: a missed day without a freeze shows 0. */
export function viewStreak(record: StreakRecord, now: Date): StreakView {
  const today = edmontonDay(now);
  const freezes = record.lastDay ? freezesToCover(record.lastDay, today, record.freezeWeeks) : null;
  const alive = freezes !== null;
  const lastAt = record.combo.lastAt ? Date.parse(record.combo.lastAt) : null;
  const comboRuns = lastAt !== null && now.getTime() - lastAt <= COMBO_WINDOW_MS;

  return {
    count: alive ? record.current : 0,
    best: record.best,
    doneToday: record.lastDay === today,
    // A freeze that is holding a missed day this week counts as spent.
    freezeReady: ![...record.freezeWeeks, ...(freezes ?? [])].includes(weekOf(today)),
    frozen: alive && freezes.length > 0,
    sparksThisWeek: record.sparks.week === weekOf(today) ? record.sparks.count : 0,
    combo: comboRuns && record.combo.count >= 2 ? record.combo.count : 0,
    week: Array.from({ length: 7 }, (_, index) => record.days.includes(addDays(weekOf(today), index))),
  };
}

/** 0 is fully lit. Each of 3, 7 and 14 days since the topic was last proved or relit dims it one step. */
export function dimLevel(litAt: string, now: Date): number {
  const days = (now.getTime() - Date.parse(litAt)) / (24 * 60 * 60 * 1000);
  return DIM_AFTER_DAYS.filter((limit) => days >= limit).length;
}

/**
 * Today's topic for a map: the same for everyone on the same day, and it changes daily.
 * A small hash of the day and map id picks one of the open topics, sorted so order never matters.
 */
export function pickTopicOfTheDay(mapId: string, day: string, openIds: string[]): string | null {
  if (openIds.length === 0) return null;
  let hash = 0;
  for (const char of `${day}/${mapId}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [...openIds].sort()[hash % openIds.length];
}

/** What the unlock moment celebrates, worked out from the habits just before and just after a proof. */
export type ProofReward = {
  combo: number;
  streak: number;
  /** This proof was today's first, so the streak grew. */
  streakGrew: boolean;
  milestone: boolean;
  sparks: number;
  topicOfTheDay: boolean;
  /** This proof reached the weekly spark goal. */
  goalReached: boolean;
};

export function rewardFor(before: MapHabits | null, after: MapHabits, nodeId: string): ProofReward {
  const streakGrew = !before?.streak.doneToday && after.streak.doneToday;
  return {
    combo: after.streak.combo,
    streak: after.streak.count,
    streakGrew,
    milestone: streakGrew && MILESTONES.includes(after.streak.count),
    sparks: Math.max(0, after.streak.sparksThisWeek - (before?.streak.sparksThisWeek ?? 0)),
    topicOfTheDay: before?.topicOfTheDay === nodeId,
    goalReached:
      (before?.streak.sparksThisWeek ?? 0) < WEEKLY_SPARK_GOAL && after.streak.sparksThisWeek >= WEEKLY_SPARK_GOAL,
  };
}
