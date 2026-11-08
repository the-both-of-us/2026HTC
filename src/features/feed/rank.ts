import type { NodeState } from "@/shared/types";
import type { Topiclet } from "./types";

/** Text cards per page. A Short goes after every SHORT_EVERY of them, so a page is about 12 items. */
export const CARDS_PER_PAGE = 9;
export const SHORT_EVERY = 3;

export type MapCards = {
  mapId: string;
  cards: Topiclet[];
  states: Record<string, NodeState>;
  /** How far each proved topic has faded, 0 to 3. */
  dim: Record<string, number>;
};

/**
 * Higher comes first. Open topics the viewer hasn't proved lead, then proved topics that are
 * fading (the more faded, the sooner), then locked ones, then topics proved recently.
 */
export function cardScore(state: NodeState | undefined, dim = 0): number {
  if (state === "available") return 4;
  if (state === "proven") return dim > 0 ? 2.5 + dim * 0.4 : 1;
  return 2;
}

/**
 * Every map's cards in feed order: each map's own cards sorted by score (ties keep the model's
 * order), then taken in turns across maps, so one big map never fills a screen alone.
 */
export function orderCards(maps: MapCards[]): Topiclet[] {
  const queues = maps.map(({ cards, states, dim }) =>
    cards
      .map((card, index) => ({ card, index, score: cardScore(states[card.nodeId], dim[card.nodeId]) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ card }) => card),
  );
  const ordered: Topiclet[] = [];
  for (let round = 0; queues.some((queue) => round < queue.length); round++) {
    for (const queue of queues) if (round < queue.length) ordered.push(queue[round]);
  }
  return ordered;
}

/** Where a page starts. Anything that is not a small whole number starts at the top. */
export function parseCursor(cursor: string | null | undefined): number {
  if (!cursor || !/^\d{1,5}$/.test(cursor)) return 0;
  return Number(cursor);
}

/**
 * The cards of one page, and after which of them a Short may go: the topic of the card just
 * before it, never the same topic twice on a page.
 */
export function planPage(ordered: Topiclet[], offset: number): { cards: Topiclet[]; shortAfter: number[]; next: number | null } {
  const cards = ordered.slice(offset, offset + CARDS_PER_PAGE);
  const shortAfter: number[] = [];
  const topics = new Set<string>();
  for (let i = SHORT_EVERY - 1; i < cards.length; i += SHORT_EVERY) {
    const topic = `${cards[i].mapId}/${cards[i].nodeId}`;
    if (topics.has(topic)) continue;
    topics.add(topic);
    shortAfter.push(i);
  }
  const next = offset + cards.length;
  return { cards, shortAfter, next: next < ordered.length ? next : null };
}
