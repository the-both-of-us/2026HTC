/**
 * Elapsed-time labels such as "3 hours ago". They read the same in every timezone, so the
 * server can render them.
 */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function span(ms: number): string | null {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return plural(minutes, "minute", "minutes");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, "hour", "hours");
  const days = Math.round(hours / 24);
  if (days < 30) return plural(days, "day", "days");
  const months = Math.round(days / 30);
  if (months < 12) return plural(months, "month", "months");
  return plural(Math.round(days / 365), "year", "years");
}

/** "just now", "5 minutes ago", "2 days ago". */
export function timeAgo(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "some time ago";
  const label = span(ms);
  return label ? `${label} ago` : "just now";
}

/** "now", "in 10 minutes", "in 3 days". */
export function timeUntil(iso: string, now: Date): string {
  const ms = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(ms)) return "soon";
  const label = span(ms);
  return label ? `in ${label}` : "now";
}

/** "2 of 7 skills proven". */
export function provenLabel(proven: number, total: number): string {
  return `${proven} of ${plural(total, "skill", "skills")} proven`;
}

/** "3 cards" or "1 card". */
export function cardsLabel(count: number): string {
  return plural(count, "card", "cards");
}
