import { describe, expect, it } from "vitest";
import { SUBJECTS } from "./catalog";
import { buildPrompt, parseAnswerLetter } from "./parse";
import { bestModels, defaultGap, median, pickModel, shapeResults, type CallRecord } from "./shape";

describe("parseAnswerLetter", () => {
  it("reads the letter after the last Answer:", () => {
    expect(parseAnswerLetter("A looks right at first. Answer: A is wrong.\nAnswer: C", 4)).toBe("C");
  });

  it("allows markdown, brackets and 'is'", () => {
    expect(parseAnswerLetter("**Answer: B**", 4)).toBe("B");
    expect(parseAnswerLetter("Final answer: **(D)**", 4)).toBe("D");
    expect(parseAnswerLetter("The answer is: J.", 10)).toBe("J");
    expect(parseAnswerLetter("answer: c", 4)).toBe("C");
  });

  it("falls back to \\boxed{X} and to a bare last line", () => {
    expect(parseAnswerLetter("so \\boxed{E}", 10)).toBe("E");
    expect(parseAnswerLetter("Reasoning...\n\n**G**", 10)).toBe("G");
  });

  it("ignores letters past the number of options", () => {
    expect(parseAnswerLetter("Answer: F", 4)).toBeNull();
    expect(parseAnswerLetter("Answer: F\nAnswer: B", 4)).toBe("B");
  });

  it("returns null when the reply never commits", () => {
    expect(parseAnswerLetter("I am not sure which one is right.", 4)).toBeNull();
    expect(parseAnswerLetter("", 4)).toBeNull();
  });
});

describe("buildPrompt", () => {
  it("letters the options and asks for Answer: X", () => {
    const prompt = buildPrompt({ id: "q", subject: "math", question: "2+2?", options: ["3", "4"], answer: "B" }, "Math");
    expect(prompt).toContain("A. 3\nB. 4");
    expect(prompt).toContain('"Answer: X"');
  });
});

const call = (model: CallRecord["model"], subject: string, n: number, correct: boolean, ms = 1000): CallRecord => ({
  model,
  subject,
  questionId: `${subject}-${n}`,
  answer: "A",
  picked: correct ? "A" : "B",
  correct,
  ms,
  inputTokens: 200,
  outputTokens: 500,
  stop: "done",
});

/** `right` of 10 questions correct for `model` on `subject`. */
const batch = (model: CallRecord["model"], subject: string, right: number) =>
  Array.from({ length: 10 }, (_, i) => call(model, subject, i, i < right));

describe("shapeResults", () => {
  const calls = [
    ...batch("gpt-oss-120b", "psychology", 8),
    ...batch("claude-haiku-5-5", "psychology", 7),
    ...batch("claude-sonnet-5-5", "psychology", 8),
    ...batch("claude-opus-5-5", "psychology", 8),
    ...batch("gpt-oss-120b", "law", 4),
    ...batch("claude-haiku-5-5", "law", 5),
    ...batch("claude-sonnet-5-5", "law", 8),
    ...batch("claude-opus-5-5", "law", 9),
  ];
  const results = shapeResults({
    generatedAt: "2026-11-08T15:00:00.000Z",
    subjects: SUBJECTS,
    questionsPerSubject: 10,
    effort: "medium",
    maxTokens: 8000,
    calls,
    lessons: [{ model: "gpt-oss-120b", topic: "t", ms: 2000, outputTokens: 2000, words: 700, validJson: true }],
    lessonTopics: ["t"],
  });

  it("scores each subject and model and drops subjects with no calls", () => {
    expect(results.subjects.map((s) => s.id)).toEqual(["psychology", "law"]);
    const law = results.subjects.find((s) => s.id === "law")!;
    expect(law.n).toBe(10);
    expect(law.scores["claude-opus-5-5"]).toMatchObject({ n: 10, correct: 9, accuracy: 90, medianSeconds: 1 });
    expect(results.totalQuestions).toBe(20);
    expect(results.calls).toBe(81);
  });

  it("works out cost per 100 questions from list prices", () => {
    // Opus: 200 in at $4/M + 500 out at $20/M = $0.0108 a call, $1.08 per 100.
    expect(results.subjects[0].scores["claude-opus-5-5"]!.costPer100).toBeCloseTo(1.08, 3);
  });

  it("works out lesson speed", () => {
    const oss = results.models.find((m) => m.id === "gpt-oss-120b")!;
    expect(oss.lessons).toMatchObject({ runs: 1, medianSeconds: 2, tokensPerSecond: 1000, avgWords: 700 });
    expect(results.models.find((m) => m.id === "claude-opus-5-5")!.lessons).toBeNull();
  });

  it("keeps gpt-oss-120b where it is close and steps up where it is not", () => {
    const [psychology, law] = results.subjects;
    expect(bestModels(psychology.scores)).toEqual(["gpt-oss-120b", "claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(pickModel(psychology.scores)).toEqual({ model: "gpt-oss-120b", gap: 0 });
    expect(defaultGap(law.scores)).toBe(50);
    // Sonnet is 10 points behind Opus, more than 5, so Opus it is.
    expect(pickModel(law.scores)).toEqual({ model: "claude-opus-5-5", gap: 0 });
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
