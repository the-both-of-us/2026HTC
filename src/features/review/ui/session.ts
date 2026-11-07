/** Pure logic for the review session, kept apart from React so it can be tested. */
import type { Grade, QueueItem } from "../types";

export const GRADE_LABELS: Record<Grade, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const GRADE_FOR_KEY: Record<string, Grade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

/** The parts of a key event the session looks at, so tests need no DOM. */
export type KeyEventLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: unknown;
};

export type KeyAction = { kind: "reveal" } | { kind: "grade"; grade: Grade };

function tagOf(target: unknown): string | null {
  if (!target || typeof target !== "object") return null;
  const tag = (target as { tagName?: unknown }).tagName;
  return typeof tag === "string" ? tag.toUpperCase() : null;
}

/** Text boxes and anything editable keep every key. */
function isTextEntry(target: unknown): boolean {
  if (target && typeof target === "object" && (target as { isContentEditable?: unknown }).isContentEditable === true) {
    return true;
  }
  const tag = tagOf(target);
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * What a key press inside the card region should do, or null to leave it to the browser.
 * Space and Enter belong to a focused button or link, so they only reveal from the card itself.
 * 1 to 4 grade once the answer shows, from the card or one of its buttons.
 */
export function keyAction(event: KeyEventLike, revealed: boolean): KeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (isTextEntry(event.target)) return null;
  if (!revealed) {
    const tag = tagOf(event.target);
    if ((event.key === " " || event.key === "Enter") && tag !== "BUTTON" && tag !== "A") return { kind: "reveal" };
    return null;
  }
  const grade = GRADE_FOR_KEY[event.key];
  return grade ? { kind: "grade", grade } : null;
}

export function cardCounter(index: number, total: number): string {
  return `Card ${index + 1} of ${total}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 cards due · 5 new", for what is left in the session. */
export function remainingLabel(remaining: QueueItem[]): string {
  const fresh = remaining.filter((item) => item.isNew).length;
  return `${plural(remaining.length - fresh, "card", "cards")} due · ${fresh} new`;
}

/** The soonest of two due times, either of which may be missing. */
export function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

/**
 * "in 10 minutes", "in 3 hours", "in 2 days". Counted in elapsed time, so it reads the same in
 * every timezone. Anything already due is "now".
 */
export function dueIn(iso: string, now: Date): string {
  const ms = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 30_000) return "now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${plural(Math.max(1, minutes), "minute", "minutes")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${plural(hours, "hour", "hours")}`;
  return `in ${plural(Math.round(hours / 24), "day", "days")}`;
}
