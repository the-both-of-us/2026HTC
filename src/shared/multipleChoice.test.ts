import { describe, expect, it } from "vitest";
import {
  cleanMcQuestion,
  gradeMc,
  mcQuestionProblem,
  MC_PROMPT_RULES,
  seededRandom,
  seedFromText,
  shuffle,
  toPublic,
  toReview,
  toStoredQuestion,
  type RawMcQuestion,
  type StoredMcQuestion,
} from "./multipleChoice";

const raw = (over: Partial<RawMcQuestion> = {}): RawMcQuestion => ({
  question: "What does a primary key do?",
  options: ["Identifies each row", "Sorts rows", "Encrypts rows", "Counts rows"],
  explanation: "It is unique per row, unlike a sort order.",
  ...over,
});

describe("mcQuestionProblem", () => {
  it("accepts a good question, including a stray label", () => {
    expect(mcQuestionProblem(raw())).toBeNull();
    expect(mcQuestionProblem(raw({ options: ["A. One", "B. Two", "C. Three", "D. Four"] }))).toBeNull();
  });
  it("gives a reason for each broken rule", () => {
    const bad: Partial<RawMcQuestion>[] = [
      { options: ["a", "b", "c"] },
      { question: " " },
      { question: "x".repeat(201) },
      { explanation: "" },
      { explanation: "x".repeat(401) },
      { explanation: "Option B is right." },
      { options: ["a", "", "c", "d"] },
      { options: ["a", "y".repeat(121), "c", "d"] },
      { options: ["a", "b", "c", "None of the above"] },
      { options: ["Same", "same ", "c", "d"] },
    ];
    for (const over of bad) expect(mcQuestionProblem(raw(over)), JSON.stringify(over)).toEqual(expect.any(String));
  });
});

describe("shuffle and storing", () => {
  it("is deterministic for a seed and keeps every item", () => {
    expect(shuffle([1, 2, 3, 4], seededRandom(3))).toEqual(shuffle([1, 2, 3, 4], seededRandom(3)));
    expect(shuffle([1, 2, 3, 4], seededRandom(3)).sort()).toEqual([1, 2, 3, 4]);
    expect(seedFromText("a")).toBe(seedFromText("a"));
    expect(seedFromText("a")).not.toBe(seedFromText("b"));
  });
  it("is unbiased enough: the correct option lands in every position", () => {
    const counts = [0, 0, 0, 0];
    for (let seed = 0; seed < 400; seed++) counts[toStoredQuestion(cleanMcQuestion(raw()), seededRandom(seed)).correctIndex]++;
    for (const c of counts) expect(c).toBeGreaterThan(60);
  });
  it("keeps the correct option at correctIndex", () => {
    for (let seed = 0; seed < 20; seed++) {
      const q = toStoredQuestion(cleanMcQuestion(raw()), seededRandom(seed));
      expect(q.options[q.correctIndex]).toBe("Identifies each row");
    }
  });
});

const stored: StoredMcQuestion[] = [
  { question: "Q1", options: ["a", "b", "c", "d"], correctIndex: 2, explanation: "e1" },
  { question: "Q2", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "e2" },
  { question: "Q3", options: ["a", "b", "c", "d"], correctIndex: 3, explanation: "e3" },
];

describe("toPublic", () => {
  it("has only question and options", () => {
    const pub = toPublic(stored[0]);
    expect(Object.keys(pub).sort()).toEqual(["options", "question"]);
    expect(JSON.stringify(pub)).not.toContain("e1");
  });
});

describe("gradeMc", () => {
  it("counts correct answers", () => {
    const g = gradeMc(stored, [2, 0, 3]);
    expect(g.correctCount).toBe(3);
    expect(g.total).toBe(3);
  });
  it("treats missing, null, out-of-range and non-integer choices as wrong", () => {
    const g = gradeMc(stored, [2, 9, undefined]);
    expect(g.correctCount).toBe(1);
    expect(g.results.map((r) => r.chosen)).toEqual([2, null, null]);
    expect(gradeMc(stored, [-1, 0.5, null]).correctCount).toBe(0);
    expect(gradeMc(stored, []).correctCount).toBe(0);
  });
  it("builds the review", () => {
    const review = toReview(gradeMc(stored, [1, 0, 3]));
    expect(review[0]).toEqual({ question: "Q1", options: ["a", "b", "c", "d"], chosen: 1, correctIndex: 2, explanation: "e1" });
    expect(Object.keys(review[1]).sort()).toEqual(["chosen", "correctIndex", "explanation", "options", "question"]);
  });
});

describe("MC_PROMPT_RULES", () => {
  it("states the shared rules", () => {
    expect(MC_PROMPT_RULES).toContain("FIRST option");
    expect(MC_PROMPT_RULES).toContain("by position");
  });
});
