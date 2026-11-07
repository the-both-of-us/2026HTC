import { describe, expect, it } from "vitest";
import { addDays, edmontonDay, weekOf } from "./days";
import {
  applyProof,
  COMBO_WINDOW_MS,
  dimLevel,
  emptyRecord,
  pickTopicOfTheDay,
  rewardFor,
  viewStreak,
  WEEKLY_SPARK_GOAL,
  type MapHabits,
} from "./rules";

const at = (iso: string) => new Date(iso);

describe("Edmonton days", () => {
  it("counts the day in Edmonton, not on the server's clock", () => {
    // 05:59 UTC on Nov 8 is still 23:59 on Nov 7 in Edmonton (UTC-6 from Nov 1, 2026).
    expect(edmontonDay(at("2026-11-08T05:59:00Z"))).toBe("2026-11-07");
    expect(edmontonDay(at("2026-11-08T06:00:00Z"))).toBe("2026-11-08");
    // In summer Edmonton is UTC-6 too (daylight time).
    expect(edmontonDay(at("2026-07-01T05:30:00Z"))).toBe("2026-06-30");
    // In January 2026 it was still UTC-7.
    expect(edmontonDay(at("2026-01-15T06:30:00Z"))).toBe("2026-01-14");
  });

  it("starts weeks on Monday", () => {
    expect(weekOf("2026-11-08")).toBe("2026-11-02"); // a Sunday
    expect(weekOf("2026-11-09")).toBe("2026-11-09"); // a Monday
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("streaks", () => {
  it("grows across Edmonton midnight, not UTC midnight", () => {
    // 11:30 PM and 12:30 AM in Edmonton: two days, so a 2-day streak.
    let record = applyProof(emptyRecord(), at("2026-11-04T05:30:00Z"), "a");
    record = applyProof(record, at("2026-11-04T06:30:00Z"), "b");
    expect(record.current).toBe(2);

    // 7 AM and 5 PM Edmonton on the same day, across UTC midnight: still one day.
    let sameDay = applyProof(emptyRecord(), at("2026-11-04T13:00:00Z"), "a");
    sameDay = applyProof(sameDay, at("2026-11-04T23:00:00Z"), "b");
    sameDay = applyProof(sameDay, at("2026-11-05T01:00:00Z"), "c");
    expect(sameDay.current).toBe(1);
  });

  it("counts a retried proof once", () => {
    const once = applyProof(emptyRecord(), at("2026-11-04T18:00:00Z"), "a");
    expect(applyProof(once, at("2026-11-04T18:01:00Z"), "a")).toBe(once);
  });

  it("shows the streak as kept until a missed day, then 0", () => {
    const record = applyProof(emptyRecord(), at("2026-11-04T18:00:00Z"), "a");
    expect(viewStreak(record, at("2026-11-04T20:00:00Z"))).toMatchObject({ count: 1, doneToday: true });
    expect(viewStreak(record, at("2026-11-05T20:00:00Z"))).toMatchObject({ count: 1, doneToday: false, frozen: false });
  });

  it("spends one freeze a week on a missed day", () => {
    // Monday, then nothing Tuesday, then Wednesday: the week's freeze covers Tuesday.
    let record = applyProof(emptyRecord(), at("2026-11-09T18:00:00Z"), "mon");
    expect(viewStreak(record, at("2026-11-11T18:00:00Z"))).toMatchObject({ count: 1, frozen: true, freezeReady: false });
    record = applyProof(record, at("2026-11-11T18:00:00Z"), "wed");
    expect(record.current).toBe(2);
    expect(record.freezeWeeks).toEqual(["2026-11-09"]);

    // Missing Thursday too: the freeze is spent, so the streak starts again on Friday.
    record = applyProof(record, at("2026-11-13T18:00:00Z"), "fri");
    expect(record.current).toBe(1);
  });

  it("can't save two missed days in the same week", () => {
    // Tuesday and Wednesday missed: two days, one week, one freeze.
    const record = applyProof(emptyRecord(), at("2026-11-09T18:00:00Z"), "mon");
    expect(viewStreak(record, at("2026-11-12T18:00:00Z")).count).toBe(0);
    // Saturday and Sunday missed: the same week, so the streak starts again on Monday.
    const friday = applyProof(emptyRecord(), at("2026-11-13T18:00:00Z"), "fri");
    expect(applyProof(friday, at("2026-11-16T18:00:00Z"), "mon").current).toBe(1);
    // Only Sunday missed: one freeze is enough.
    const saturday = applyProof(emptyRecord(), at("2026-11-14T18:00:00Z"), "sat");
    expect(applyProof(saturday, at("2026-11-16T18:00:00Z"), "mon").current).toBe(2);
  });

  it("builds a combo for proofs back to back, and drops it after a break", () => {
    const start = Date.parse("2026-11-04T18:00:00Z");
    let record = applyProof(emptyRecord(), new Date(start), "a");
    record = applyProof(record, new Date(start + 5 * 60_000), "b");
    record = applyProof(record, new Date(start + 10 * 60_000), "c");
    expect(record.combo.count).toBe(3);
    expect(viewStreak(record, new Date(start + 11 * 60_000)).combo).toBe(3);
    expect(viewStreak(record, new Date(start + 10 * 60_000 + COMBO_WINDOW_MS + 1)).combo).toBe(0);

    record = applyProof(record, new Date(start + 10 * 60_000 + COMBO_WINDOW_MS + 1), "d");
    expect(record.combo.count).toBe(1);
  });

  it("gives double sparks for the topic of the day, and marks the week's days", () => {
    let record = applyProof(emptyRecord(), at("2026-11-09T18:00:00Z"), "a", true);
    record = applyProof(record, at("2026-11-11T18:00:00Z"), "b");
    const view = viewStreak(record, at("2026-11-11T19:00:00Z"));
    expect(view.sparksThisWeek).toBe(3);
    expect(view.week).toEqual([true, false, true, false, false, false, false]);
    // A new week starts the sparks again.
    expect(viewStreak(record, at("2026-11-16T19:00:00Z")).sparksThisWeek).toBe(0);
  });
});

describe("keeping the map lit", () => {
  const proved = "2026-11-01T12:00:00Z";
  const after = (days: number) => new Date(Date.parse(proved) + days * 24 * 60 * 60 * 1000);

  it("dims a step at 3, 7 and 14 days", () => {
    expect(dimLevel(proved, after(2.9))).toBe(0);
    expect(dimLevel(proved, after(3))).toBe(1);
    expect(dimLevel(proved, after(6.9))).toBe(1);
    expect(dimLevel(proved, after(7))).toBe(2);
    expect(dimLevel(proved, after(14))).toBe(3);
    expect(dimLevel(proved, after(90))).toBe(3);
  });
});

describe("topic of the day", () => {
  it("picks the same open topic all day, whatever order the topics come in", () => {
    const first = pickTopicOfTheDay("map", "2026-11-07", ["a", "b", "c"]);
    expect(pickTopicOfTheDay("map", "2026-11-07", ["c", "a", "b"])).toBe(first);
    expect(["a", "b", "c"]).toContain(first);
    expect(pickTopicOfTheDay("map", "2026-11-07", [])).toBeNull();
  });
});

describe("the unlock moment's reward", () => {
  const habits = (streak: Partial<MapHabits["streak"]>, topicOfTheDay: string | null = null): MapHabits => ({
    streak: { count: 0, best: 0, doneToday: false, freezeReady: true, frozen: false, sparksThisWeek: 0, combo: 0, week: [], ...streak },
    topicOfTheDay,
    dim: {},
  });

  it("celebrates the streak growing, the combo, the topic of the day and the weekly goal", () => {
    const before = habits({ count: 2, sparksThisWeek: WEEKLY_SPARK_GOAL - 2 }, "joins");
    const after = habits({ count: 3, doneToday: true, sparksThisWeek: WEEKLY_SPARK_GOAL, combo: 2 });
    expect(rewardFor(before, after, "joins")).toEqual({
      combo: 2,
      streak: 3,
      streakGrew: true,
      milestone: true,
      sparks: 2,
      topicOfTheDay: true,
      goalReached: true,
    });
  });

  it("doesn't celebrate the streak twice in a day", () => {
    const reward = rewardFor(habits({ count: 3, doneToday: true }), habits({ count: 3, doneToday: true }), "x");
    expect(reward.streakGrew).toBe(false);
    expect(reward.milestone).toBe(false);
  });
});
