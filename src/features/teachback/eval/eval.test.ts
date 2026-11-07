import { describe, expect, it } from "vitest";
import { countWords } from "../learnerText";
import cases from "./cases.json";
import { majorityVerdict, percentile, summarize, toRate, type EvalCase, type RunRecord } from "./metrics";
import { runPlantedQuotes } from "./plantedQuotes";
import skills from "./skills.json";

function record(caseId: string, run: number, score: number | null): RunRecord {
  return {
    caseId,
    run,
    ms: run * 1000,
    score,
    verdict: score === null ? null : score >= 70 ? "pass" : "fail",
    met: 0,
    total: 4,
    credited: [],
    misconceptions: [],
    quotesReturned: 2,
    rejectedQuotes: 1,
    rejected: [],
    calls: [{ host: "x", status: 200, ms: 1, promptTokens: 1_000_000, completionTokens: 1_000_000 }],
    error: score === null ? "AiUnavailableError" : null,
  };
}

const evalCase = (id: string, expected: "pass" | "fail"): EvalCase => ({
  id,
  skill: "sql",
  category: "x",
  expected,
  why: "",
  text: "",
});

describe("the dataset", () => {
  it("has what the eval promises", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(new Set(cases.map((item) => item.skill)).size).toBeGreaterThanOrEqual(6);
    for (const category of ["strong-correct", "informal-correct", "partly-correct", "confidently-wrong", "fluent-empty", "ai-generic", "prompt-injection"]) {
      expect(cases.some((item) => item.category === category)).toBe(true);
    }
    expect(skills.filter((skill) => skill.origin.startsWith("generated"))).toHaveLength(2);
  });

  it("only has cases the app would accept and that can be read later", () => {
    const skillKeys = new Set(skills.map((skill) => skill.key));
    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    for (const item of cases) {
      expect(skillKeys.has(item.skill), item.id).toBe(true);
      expect(["pass", "fail"]).toContain(item.expected);
      expect(item.why.length, item.id).toBeGreaterThan(0);
      expect(countWords(item.text), item.id).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("the metrics", () => {
  it("counts false passes and false fails by majority of runs", () => {
    const summary = summarize(
      [evalCase("a", "fail"), evalCase("b", "pass"), evalCase("c", "fail")],
      [
        ...[1, 2, 3].map((run) => record("a", run, run === 1 ? 20 : 80)), // false pass, 2 of 3
        ...[1, 2, 3].map((run) => record("b", run, 40)), // false fail
        ...[1, 2, 3].map((run) => record("c", run, run === 1 ? 80 : 0)), // right, but passed once
      ],
    );

    expect(summary.falsePass.hits).toBe(1);
    expect(summary.falsePass.total).toBe(2);
    expect(summary.falseFail.hits).toBe(1);
    expect(summary.agreement.hits).toBe(1);
    expect(summary.falsePassRuns.hits).toBe(3);
    expect(summary.falsePassAnyRun.hits).toBe(2);
    expect(summary.consistency.hits).toBe(1);
    expect(summary.maxScoreRange).toBe(80);
  });

  it("leaves errored runs out of the verdicts but counts them", () => {
    const summary = summarize([evalCase("a", "fail")], [record("a", 1, null), record("a", 2, 0), record("a", 3, 0)]);
    expect(summary.erroredRuns).toBe(1);
    expect(summary.falsePassRuns.total).toBe(2);
    expect(summary.falsePass.hits).toBe(0);
  });

  it("prices tokens at the listed rate", () => {
    const summary = summarize([evalCase("a", "fail")], [record("a", 1, 0)]);
    expect(summary.costUsd).toBeCloseTo(1.1);
  });

  it("calls a tie a pass, the worse outcome", () => {
    expect(majorityVerdict([record("a", 1, 80), record("a", 2, 0)])).toBe("pass");
    expect(majorityVerdict([record("a", 1, null)])).toBeNull();
  });

  it("computes percentiles by nearest rank", () => {
    expect(percentile([3, 1, 2, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
  });

  it("gives a Wilson range that does not claim zero from a small sample", () => {
    const rate = toRate(0, 40);
    expect(rate.low).toBe(0);
    expect(rate.high).toBeGreaterThan(0.08);
    expect(rate.high).toBeLessThan(0.1);
  });
});

describe("planted fake quotes", () => {
  it("are all rejected by the real gradeExplanation", async () => {
    const results = await runPlantedQuotes();
    expect(results.length).toBeGreaterThanOrEqual(6);
    expect(results.filter((item) => !item.rejected)).toEqual([]);
  });
});
