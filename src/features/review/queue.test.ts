import { describe, expect, it } from "vitest";
import { buildQueue, NEW_CARDS_PER_QUEUE, type CardSource } from "./queue";
import type { ReviewCard } from "./types";

const NOW = new Date("2026-11-07T12:00:00.000Z");

function source(cardId: string): CardSource {
  return { cardId, mapId: "m", nodeId: "n", front: `Q ${cardId}`, back: `A ${cardId}`, mapTitle: "Map", skillTitle: "Skill" };
}

function state(cardId: string, dueAt: string): ReviewCard {
  return {
    cardId,
    mapId: "m",
    nodeId: "n",
    intervalDays: 6,
    ease: 2.5,
    repetitions: 2,
    lapses: 0,
    dueAt,
    lastReviewedAt: "2026-11-01T12:00:00.000Z",
  };
}

describe("buildQueue", () => {
  it("puts due reviews first, oldest due first, then new cards in the order given", () => {
    const sources = ["new1", "late", "future", "new2", "later", "dueNow"].map(source);
    const states = new Map([
      ["late", state("late", "2026-11-06T12:00:00.000Z")],
      ["later", state("later", "2026-11-01T12:00:00.000Z")],
      ["dueNow", state("dueNow", NOW.toISOString())],
      ["future", state("future", "2026-11-09T12:00:00.000Z")],
    ]);
    const result = buildQueue(sources, states, NOW);
    expect(result.queue.map((item) => item.cardId)).toEqual(["later", "late", "dueNow", "new1", "new2"]);
    expect(result.queue.map((item) => item.isNew)).toEqual([false, false, false, true, true]);
    expect(result).toMatchObject({ dueCount: 3, newCount: 2, totalCards: 6, nextDueAt: "2026-11-09T12:00:00.000Z" });
  });

  it("offers at most 20 new cards, but every due review", () => {
    const fresh = Array.from({ length: 30 }, (_, i) => source(`new${i}`));
    const due = Array.from({ length: 25 }, (_, i) => source(`due${i}`));
    const states = new Map(due.map((s) => [s.cardId, state(s.cardId, "2026-11-01T00:00:00.000Z")]));
    const result = buildQueue([...fresh, ...due], states, NOW);
    expect(result.queue).toHaveLength(25 + NEW_CARDS_PER_QUEUE);
    expect(result.queue.slice(0, 25).every((item) => !item.isNew)).toBe(true);
    expect(result.queue.slice(25).map((item) => item.cardId)).toEqual(fresh.slice(0, 20).map((s) => s.cardId));
    expect(result).toMatchObject({ dueCount: 25, newCount: 20, moreNew: 10, totalCards: 55 });
  });

  it("reports the new cards left past the cap, even when nothing is scheduled", () => {
    // Three decks of 10: a 20-card session leaves 10 new cards that are due right away.
    const fresh = Array.from({ length: 30 }, (_, i) => source(`new${i}`));
    expect(buildQueue(fresh, new Map(), NOW)).toMatchObject({ newCount: 20, moreNew: 10, nextDueAt: null });

    const afterSession = new Map(fresh.slice(0, 20).map((s) => [s.cardId, state(s.cardId, "2026-11-08T12:00:00.000Z")]));
    const next = buildQueue(fresh, afterSession, NOW);
    expect(next).toMatchObject({ dueCount: 0, newCount: 10, moreNew: 0, nextDueAt: "2026-11-08T12:00:00.000Z" });
    expect(buildQueue(fresh.slice(0, 5), new Map(), NOW).moreNew).toBe(0);
  });

  it("ignores states for cards that no longer exist, and has no next time when nothing is scheduled", () => {
    const states = new Map([["gone", state("gone", "2026-11-01T00:00:00.000Z")]]);
    expect(buildQueue([source("a")], states, NOW)).toMatchObject({ dueCount: 0, newCount: 1, moreNew: 0, totalCards: 1, nextDueAt: null });
  });

  it("gives each card the interval every grade would set", () => {
    const [item] = buildQueue([source("a")], new Map(), NOW).queue;
    expect(item.intervals).toEqual({ again: 0, hard: 1, good: 1, easy: 2 });
  });
});
