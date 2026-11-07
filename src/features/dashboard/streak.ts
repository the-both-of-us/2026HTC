/**
 * The day streak, as plain functions, so it can be tested without a browser. Days are the
 * viewer's local days: `offsetFor` gives minutes east of UTC at a moment (in a browser,
 * `-date.getTimezoneOffset()`), so a day that crosses a clock change still counts right.
 */

export type StreakDay = { dayKey: string; active: boolean; isToday: boolean };
export type Streak = {
  /** Consecutive active days, ending today, or yesterday if today has no activity yet. */
  count: number;
  activeToday: boolean;
  /** The last seven days, oldest first, ending today. */
  week: StreakDay[];
};

export type OffsetFor = (date: Date) => number;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-11-07": the local calendar day of a moment. */
export function localDayKey(date: Date, offsetMinutes: number): string {
  return new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** The calendar day `days` after (or before, if negative) a day key. Pure calendar arithmetic. */
export function shiftDay(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

export function computeStreak(timestamps: string[], now: Date, offsetFor: OffsetFor): Streak {
  const active = new Set<string>();
  for (const iso of timestamps) {
    const date = new Date(iso);
    if (Number.isFinite(date.getTime())) active.add(localDayKey(date, offsetFor(date)));
  }

  const today = localDayKey(now, offsetFor(now));
  const activeToday = active.has(today);
  let cursor = activeToday ? today : shiftDay(today, -1);
  let count = 0;
  while (active.has(cursor)) {
    count += 1;
    cursor = shiftDay(cursor, -1);
  }

  const week = Array.from({ length: 7 }, (_, index) => {
    const dayKey = shiftDay(today, index - 6);
    return { dayKey, active: active.has(dayKey), isToday: dayKey === today };
  });
  return { count, activeToday, week };
}

/** The line under the count. */
export function streakMessage({ count, activeToday }: Streak): string {
  if (count === 0) return "Prove a skill or review a card today to start a streak.";
  if (!activeToday) return "Keep it going today.";
  return "You have been active today.";
}
