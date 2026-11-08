import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import type { SkillNode } from "@/shared/types";
import { forAudience, GRADER_NOTE } from "./audience";
import { CHECKER_SYSTEM as CATCH_CHECKER, WRITER_SYSTEM } from "./catch";
import { ANSWER_SYSTEM as FINAL_ANSWER, QUESTIONS_SYSTEM } from "./final";
import { ANSWER_SYSTEM, generateFollowUp, gradeFollowUp, QUESTION_SYSTEM } from "./followUp";
import { formatLabel, FORMAT_LABELS } from "./formats";
import { CHECKER_SYSTEM, GRADER_SYSTEM, gradeExplanation } from "./grading";

vi.mock("@/features/ai", () => ({ chatJSON: vi.fn() }));

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const GRADE_1 = "Grade 1 students (about 6 years old)";

const NODE: SkillNode = {
  id: "count",
  title: "Counting to 100",
  why: "You count your toys.",
  prerequisites: [],
  fromSource: false,
  citation: null,
  checkpoints: ["Each thing gets counted exactly once, one number for each thing."],
};

beforeEach(() => vi.mocked(chatJSON).mockReset());

describe("teach-back prompts with no audience", () => {
  it("are byte for byte the prompts the eval baseline was measured on", () => {
    expect(hash(GRADER_SYSTEM)).toBe("e374772604c60ff8");
    expect(hash(CHECKER_SYSTEM)).toBe("9e5c6577847c85b9");
    expect(hash(QUESTION_SYSTEM)).toBe("4c830805299161f2");
    expect(hash(ANSWER_SYSTEM)).toBe("575823d33a9a843b");
    expect(hash(WRITER_SYSTEM)).toBe("957c1f69b76cf6f6");
    expect(hash(CATCH_CHECKER)).toBe("6c2c5625fbcf8d5a");
    expect(hash(QUESTIONS_SYSTEM)).toBe("ee8c6ac18a6275be");
    expect(hash(FINAL_ANSWER)).toBe("22159fdcef771bdf");
    expect(forAudience(GRADER_SYSTEM, "", GRADER_NOTE)).toBe(GRADER_SYSTEM);
    expect(forAudience(GRADER_SYSTEM, undefined, GRADER_NOTE)).toBe(GRADER_SYSTEM);
  });

  it("send the unchanged prompt to the grader when the map has no audience", async () => {
    vi.mocked(chatJSON).mockResolvedValue({ checkpoints: [{ number: 1, quote: null }], factualErrors: [] });
    await gradeExplanation(NODE, "some words here");
    expect(vi.mocked(chatJSON).mock.calls[0][0].system).toBe(GRADER_SYSTEM);
  });
});

describe("teach-back prompts with an audience", () => {
  it("tell the grader who the learner is: lenient on words, strict on facts", async () => {
    const text = "you count each thing once and don't skip any, and the last number is how many";
    vi.mocked(chatJSON).mockResolvedValue({
      checkpoints: [{ number: 1, quote: "you count each thing once and don't skip any" }],
      factualErrors: [],
    });
    const grade = await gradeExplanation(NODE, text, GRADE_1);
    const system = vi.mocked(chatJSON).mock.calls[0][0].system ?? "";
    expect(system.startsWith(GRADER_SYSTEM)).toBe(true);
    expect(system).toContain(`THE LEARNER\nThe learner is: ${GRADE_1}.`);
    expect(system).toContain("Accuracy still matters");
    expect(grade.score).toBe(100);
  });

  it("pitch the follow-up question and its grading too", async () => {
    vi.mocked(chatJSON).mockResolvedValueOnce({ question: "What if you skip a toy?" });
    const grade = { score: 100, checkpoints: [], misconceptions: [], rejectedQuotes: 0 };
    await generateFollowUp(NODE, "words", grade, GRADE_1);
    vi.mocked(chatJSON).mockResolvedValueOnce({ passed: true, feedback: "Yes!" });
    await gradeFollowUp(NODE, "words", "What if you skip a toy?", "then the number is wrong", GRADE_1);
    expect(vi.mocked(chatJSON).mock.calls[0][0].system).toContain("at most 20 words");
    expect(vi.mocked(chatJSON).mock.calls[1][0].system).toContain("childlike answers are fine");
  });

  it("call the kid format explaining to a friend for young children only", () => {
    expect(formatLabel("kid")).toBe(FORMAT_LABELS.kid);
    expect(formatLabel("kid", true).name).toBe("Explain it to a friend");
    expect(formatLabel("catch", true)).toBe(FORMAT_LABELS.catch);
  });
});
