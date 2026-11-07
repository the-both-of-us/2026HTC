import { describe, expect, it } from "vitest";
import {
  applyGrade,
  dueAtFor,
  formatInterval,
  NEW_SCHEDULE,
  nextEase,
  previewIntervals,
  reviewCard,
  type Schedule,
} from "./sm2";
import type { Grade } from "./types";

const at = (intervalDays: number, repetitions: number, ease = 2.5, lapses = 0): Schedule => ({
  intervalDays,
  ease,
  repetitions,
  lapses,
});

describe("SM-2 schedule", () => {
  // [state before, grade, interval days, ease, repetitions, lapses]
  const table: [string, Schedule, Grade, number, number, number, number][] = [
    ["new, again", NEW_SCHEDULE, "again", 0, 2.3, 0, 0],
    ["new, hard", NEW_SCHEDULE, "hard", 1, 2.36, 1, 0],
    ["new, good", NEW_SCHEDULE, "good", 1, 2.5, 1, 0],
    ["new, easy", NEW_SCHEDULE, "easy", 2, 2.6, 1, 0],
    ["second, again (a lapse)", at(1, 1), "again", 0, 2.3, 0, 1],
    ["second, hard", at(1, 1), "hard", 2, 2.36, 2, 0],
    ["second, good", at(1, 1), "good", 6, 2.5, 2, 0],
    ["second, easy", at(1, 1), "easy", 8, 2.6, 2, 0],
    ["third, hard: 6 x 1.2", at(6, 2), "hard", 7, 2.36, 3, 0],
    ["third, good: 6 x 2.5", at(6, 2), "good", 15, 2.5, 3, 0],
    ["third, easy: round(6 x 2.6) x 1.3", at(6, 2), "easy", 21, 2.6, 3, 0],
    ["fourth, good uses the ease: 15 x 2.36", at(15, 3, 2.36), "good", 35, 2.36, 4, 0],
    ["ease never drops below 1.3 on hard", at(10, 3, 1.3), "hard", 12, 1.3, 4, 0],
    ["ease never drops below 1.3 on again", at(10, 3, 1.4, 2), "again", 0, 1.3, 0, 3],
    ["intervals stop at a year", at(300, 5), "good", 365, 2.5, 6, 0],
    ["after a lapse, good starts again at 1 day", at(0, 0, 2.3, 1), "good", 1, 2.3, 1, 1],
  ];

  it.each(table)("%s", (_name, before, grade, intervalDays, ease, repetitions, lapses) => {
    expect(applyGrade(before, grade)).toEqual({ intervalDays, ease, repetitions, lapses });
  });

  it("uses EF' = EF + (0.1 - (5-q)(0.08 + (5-q)0.02)) with q = 3, 4, 5", () => {
    expect(nextEase(2.5, "easy")).toBe(2.6);
    expect(nextEase(2.5, "good")).toBe(2.5);
    expect(nextEase(2.5, "hard")).toBe(2.36);
    expect(nextEase(2.5, "again")).toBe(2.3);
  });

  it("orders the intervals again < hard <= good < easy", () => {
    for (const before of [NEW_SCHEDULE, at(1, 1), at(6, 2), at(2, 2, 1.3), at(40, 4, 1.9)]) {
      const p = previewIntervals(before);
      expect(p.again).toBe(0);
      expect(p.hard).toBeGreaterThan(0);
      expect(p.hard).toBeLessThanOrEqual(p.good);
      expect(p.easy).toBeGreaterThan(p.good);
    }
  });

  it("brings an Again card back in 10 minutes and others after whole days", () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    expect(dueAtFor(0, now)).toBe("2026-11-07T12:10:00.000Z");
    expect(dueAtFor(6, now)).toBe("2026-11-13T12:00:00.000Z");
  });

  it("builds a full card state with when it was reviewed", () => {
    const now = new Date("2026-11-07T12:00:00.000Z");
    const ids = { cardId: "c", mapId: "m", nodeId: "n" };
    const first = reviewCard(null, ids, "good", now);
    expect(first).toEqual({
      ...ids,
      intervalDays: 1,
      ease: 2.5,
      repetitions: 1,
      lapses: 0,
      dueAt: "2026-11-08T12:00:00.000Z",
      lastReviewedAt: now.toISOString(),
    });
    const later = new Date("2026-11-08T13:00:00.000Z");
    expect(reviewCard(first, ids, "good", later)).toMatchObject({ intervalDays: 6, repetitions: 2 });
  });

  it("labels intervals for the buttons", () => {
    expect([0, 1, 6, 30, 45, 200, 365].map(formatInterval)).toEqual([
      "10 min",
      "1 day",
      "6 days",
      "30 days",
      "2 months",
      "7 months",
      "1 year",
    ]);
  });
});
