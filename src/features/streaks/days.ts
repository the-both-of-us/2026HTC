/**
 * Days are Edmonton calendar days, written "YYYY-MM-DD", whatever clock the server runs on.
 *
 * Alberta stays on UTC-6 all year from 1 November 2026 (tz database 2026c). Node's own
 * time-zone data can predate that and would still say UTC-7 in winter, which moves midnight
 * by an hour. So from that moment on we use the fixed offset, and Intl before it.
 */
const PERMANENT_UTC_MINUS_6 = Date.parse("2026-11-01T08:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const EDMONTON = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Edmonton",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Edmonton date at this moment. */
export function edmontonDay(at: Date): string {
  if (at.getTime() >= PERMANENT_UTC_MINUS_6) {
    return new Date(at.getTime() - 6 * HOUR_MS).toISOString().slice(0, 10);
  }
  const parts = Object.fromEntries(EDMONTON.formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The day `count` days after `day` (or before, when negative). */
export function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

/** How many days from `from` to `to`: 1 for the next day, 0 for the same day. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The Monday that starts this day's week. A week's one freeze is filed under it. */
export function weekOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(day, -((weekday + 6) % 7));
}
