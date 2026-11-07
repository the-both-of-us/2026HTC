import { describe, expect, it } from "vitest";
import { computeStreak, localDayKey, shiftDay, streakMessage } from "./streak";

// Fixed offsets, so these pass whatever timezone the machine running them is in.
const UTC = () => 0;
const CALGARY = () => -7 * 60; // MST
const TOKYO = () => 9 * 60;

describe("streak days", () => {
  it("finds the local calendar day for an offset", () => {
    const moment = new Date("2026-11-07T03:00:00.000Z");
    expect(localDayKey(moment, 0)).toBe("2026-11-07");
    expect(localDayKey(moment, -420)).toBe("2026-11-06");
    expect(localDayKey(new Date("2026-11-07T16:00:00.000Z"), 540)).toBe("2026-11-08");
  });

  it("steps across month and year ends", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("computeStreak", () => {
  const now = new Date("2026-11-07T18:00:00.000Z");

  it("counts consecutive days ending today", () => {
    const activity = ["2026-11-05T15:00:00.000Z", "2026-11-06T15:00:00.000Z", "2026-11-07T15:00:00.000Z", "2026-11-07T16:00:00.000Z"];
    const streak = computeStreak(activity, now, UTC);
    expect(streak).toMatchObject({ count: 3, activeToday: true });
    expect(streakMessage(streak)).toBe("You have been active today.");
  });

  it("still shows yesterday's streak when today has no activity yet", () => {
    const streak = computeStreak(["2026-11-05T15:00:00.000Z", "2026-11-06T15:00:00.000Z"], now, UTC);
    expect(streak).toMatchObject({ count: 2, activeToday: false });
    expect(streakMessage(streak)).toBe("Keep it going today.");
  });

  it("is zero after a missed day", () => {
    const streak = computeStreak(["2026-11-04T15:00:00.000Z", "2026-11-05T15:00:00.000Z"], now, UTC);
    expect(streak.count).toBe(0);
    expect(streakMessage(streak)).toMatch(/start a streak/);
  });

  it("uses the viewer's own days", () => {
    // 02:00 UTC on the 7th is the evening of the 6th in Calgary.
    const activity = ["2026-11-06T15:00:00.000Z", "2026-11-07T02:00:00.000Z"];
    expect(computeStreak(activity, now, UTC).count).toBe(2);
    expect(computeStreak(activity, now, CALGARY)).toMatchObject({ count: 1, activeToday: false });
    // In Tokyo, now is already the 8th: the 7th (11:00 local) was yesterday.
    expect(computeStreak(activity, now, TOKYO)).toMatchObject({ count: 1, activeToday: false });
  });

  it("gives seven days ending today, oldest first, with which were active", () => {
    const streak = computeStreak(["2026-11-02T12:00:00.000Z", "2026-11-07T12:00:00.000Z"], now, UTC);
    expect(streak.week.map((day) => day.dayKey)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
    ]);
    expect(streak.week.map((day) => day.active)).toEqual([false, true, false, false, false, false, true]);
    expect(streak.week.filter((day) => day.isToday).map((day) => day.dayKey)).toEqual(["2026-11-07"]);
  });

  it("ignores unreadable timestamps", () => {
    expect(computeStreak(["nonsense"], now, UTC).count).toBe(0);
  });
});
