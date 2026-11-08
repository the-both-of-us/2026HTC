import { describe, expect, it } from "vitest";
import type { CourseRating } from "@/shared/types";
import { autoTier, baseTier, chooseTier, DEFAULT_RATING, guessRating, toRating } from "./router";
import { DEFAULT_AI_SETTINGS, type AiSettings, type AiTask } from "./types";

const r = (difficulty: 1 | 2 | 3, stakes: 1 | 2 | 3): CourseRating => ({ difficulty, stakes });
const TASKS: AiTask[] = ["map", "lesson", "flashcards", "quiz", "checks", "other"];

/** Every rating's tier per task, rows "difficulty/stakes", columns in TASKS order. */
function table(settings: AiSettings): Record<string, number[]> {
  const rows: Record<string, number[]> = {};
  for (const difficulty of [1, 2, 3] as const) {
    for (const stakes of [1, 2, 3] as const) {
      rows[`${difficulty}/${stakes}`] = TASKS.map((task) => chooseTier(task, r(difficulty, stakes), settings));
    }
  }
  return rows;
}

describe("the base tier", () => {
  it("keeps everyday courses on gpt-oss-120b and steps up only when one axis is 3", () => {
    expect([baseTier(r(1, 1)), baseTier(r(2, 2)), baseTier(r(1, 2)), baseTier(r(2, 1))]).toEqual([1, 1, 1, 1]);
    expect([baseTier(r(3, 1)), baseTier(r(1, 3))]).toEqual([2, 2]);
    expect([baseTier(r(3, 2)), baseTier(r(2, 3))]).toEqual([3, 3]);
    expect(baseTier(r(3, 3))).toBe(4);
  });
});

describe("Auto", () => {
  it("routes every task by the table", () => {
    //                 map lesson cards quiz checks other
    expect(table(DEFAULT_AI_SETTINGS)).toEqual({
      "1/1": [1, 1, 1, 1, 1, 1],
      "1/2": [1, 1, 1, 1, 1, 1],
      "1/3": [3, 2, 1, 1, 2, 1],
      "2/1": [1, 1, 1, 1, 1, 1],
      "2/2": [1, 1, 1, 1, 1, 1],
      "2/3": [3, 3, 2, 2, 2, 1],
      "3/1": [3, 2, 1, 1, 1, 1],
      "3/2": [3, 3, 2, 2, 1, 1],
      "3/3": [3, 4, 2, 2, 2, 1],
    });
  });

  it("treats an unrated map as an everyday course", () => {
    expect(DEFAULT_RATING).toEqual(r(2, 2));
    for (const task of TASKS) expect(chooseTier(task, undefined, DEFAULT_AI_SETTINGS)).toBe(autoTier(task, r(2, 2)));
  });

  it("never puts flashcards or quiz above Haiku, nor the map above Sonnet", () => {
    for (const row of Object.values(table(DEFAULT_AI_SETTINGS))) {
      expect(row[0]).toBeLessThanOrEqual(3);
      expect(row[2]).toBeLessThanOrEqual(2);
      expect(row[3]).toBeLessThanOrEqual(2);
    }
  });
});

describe("speed and overrides", () => {
  it("Fast is gpt-oss-120b everywhere", () => {
    for (const row of Object.values(table({ speed: "fast", overrides: {} }))) expect(row).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("Thorough is one step up from Auto, at most Opus, and leaves other tasks alone", () => {
    const thorough = table({ speed: "thorough", overrides: {} });
    const auto = table(DEFAULT_AI_SETTINGS);
    for (const [rating, row] of Object.entries(thorough)) {
      row.slice(0, 5).forEach((tier, index) => expect(tier).toBe(Math.min(auto[rating][index] + 1, 4)));
      expect(row[5]).toBe(1);
    }
  });

  it("an override picks that model for its task whatever the speed, and Auto means no override", () => {
    const settings: AiSettings = { speed: "fast", overrides: { lesson: "opus", checks: "haiku", quiz: "auto" } };
    expect(chooseTier("lesson", r(1, 1), settings)).toBe(4);
    expect(chooseTier("checks", r(1, 1), settings)).toBe(2);
    expect(chooseTier("quiz", r(3, 3), settings)).toBe(1);
    expect(chooseTier("map", r(3, 3), { speed: "auto", overrides: { map: "oss" } })).toBe(1);
    expect(chooseTier("other", r(3, 3), { speed: "thorough", overrides: { lesson: "opus" } })).toBe(1);
  });
});

describe("ratings", () => {
  it("clamps the model's numbers and fills gaps from the guess", () => {
    expect(toRating({ difficulty: 3, stakes: 1 }, r(2, 2))).toEqual(r(3, 1));
    expect(toRating({ difficulty: 7, stakes: 0 }, r(2, 2))).toEqual(r(3, 1));
    expect(toRating({ difficulty: 2.6, stakes: null }, r(1, 3))).toEqual(r(3, 3));
    expect(toRating({}, r(1, 2))).toEqual(r(1, 2));
    expect(toRating({ difficulty: "hard" }, r(2, 2))).toEqual(r(2, 2));
  });

  it("guesses from the request before any model call", () => {
    expect(guessRating("Counting to 100", "Grade 1 students (about 6 years old)")).toEqual(r(1, 1));
    expect(guessRating("Medication dosage calculations")).toEqual(r(2, 3));
    expect(guessRating("Residential electrical wiring")).toEqual(r(2, 3));
    expect(guessRating("Advanced distributed systems")).toEqual(r(3, 2));
    expect(guessRating("Intro to Python")).toEqual(r(1, 2));
    expect(guessRating("Chess openings")).toEqual(r(2, 1));
    expect(guessRating("SQL window functions")).toEqual(r(2, 2));
    // Type safety is not workplace safety.
    expect(guessRating("TypeScript type safety")).toEqual(r(2, 2));
  });

  it("reads only the start of a long posting, so one line deep in the duties does not decide", () => {
    const posting = `Junior Backend Developer at Acme. ${"Build APIs and write tests. ".repeat(30)} Some finance reporting.`;
    expect(guessRating(posting)).toEqual(r(2, 2));
  });
});
