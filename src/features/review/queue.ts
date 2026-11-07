/** Builds the review queue from cards and their saved states. Pure: `now` is passed in. */
import { previewIntervals } from "./sm2";
import type { QueueItem, ReviewCard, ReviewQueue, ReviewSummary } from "./types";

/** At most this many new cards per queue, so a big new deck never buries the reviews. */
export const NEW_CARDS_PER_QUEUE = 20;

/** One flashcard on one of the learner's own maps, in map, skill and deck order. */
export type CardSource = {
  cardId: string;
  mapId: string;
  nodeId: string;
  front: string;
  back: string;
  mapTitle: string;
  skillTitle: string;
};

function toItem(source: CardSource, state: ReviewCard | null): QueueItem {
  return { ...source, isNew: state === null, intervals: previewIntervals(state) };
}

/**
 * Due reviews first, the longest overdue first, then up to 20 new cards in the order given
 * (newest map first, skills in map order, cards in deck order). States for cards that no longer
 * exist, such as a deleted map's, are ignored.
 */
export function buildQueue(sources: CardSource[], states: Map<string, ReviewCard>, now: Date): ReviewQueue {
  const nowMs = now.getTime();
  const due: { source: CardSource; state: ReviewCard }[] = [];
  const fresh: CardSource[] = [];
  let nextDueMs: number | null = null;

  for (const source of sources) {
    const state = states.get(source.cardId) ?? null;
    if (!state) {
      fresh.push(source);
      continue;
    }
    const dueMs = Date.parse(state.dueAt);
    // An unreadable date counts as due, so a damaged record can't hide a card for ever.
    if (!Number.isFinite(dueMs) || dueMs <= nowMs) due.push({ source, state });
    else if (nextDueMs === null || dueMs < nextDueMs) nextDueMs = dueMs;
  }

  due.sort((a, b) => (Date.parse(a.state.dueAt) || 0) - (Date.parse(b.state.dueAt) || 0));
  const newToday = fresh.slice(0, NEW_CARDS_PER_QUEUE);

  return {
    queue: [...due.map(({ source, state }) => toItem(source, state)), ...newToday.map((source) => toItem(source, null))],
    dueCount: due.length,
    newCount: newToday.length,
    moreNew: fresh.length - newToday.length,
    totalCards: sources.length,
    nextDueAt: nextDueMs === null ? null : new Date(nextDueMs).toISOString(),
  };
}

export function toSummary({ dueCount, newCount, moreNew, totalCards, nextDueAt }: ReviewQueue): ReviewSummary {
  return { dueCount, newCount, moreNew, totalCards, nextDueAt };
}
