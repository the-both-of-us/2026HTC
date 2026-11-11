import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { skillBlock } from "@/features/skill-map";
import type { SkillNode } from "@/shared/types";
import { buildQuizPrompt, QUIZ_SYSTEM_PROMPT, quizSystemPrompt } from "./prompt";

vi.mock("@/features/skill-map", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/skill-map")>()),
  skillBlock: vi.fn(() => ["Objectives: explain X", "Key terms: alpha, beta"]),
}));

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

const NODE: SkillNode = {
  id: "n1",
  title: "Joins",
  why: "Because",
  prerequisites: [],
  fromSource: true,
  citation: null,
  checkpoints: ["Inner join keeps only matching rows", "Left join keeps all left rows", "Joins use keys", "Nulls appear for no match"],
};
const SYLLABUS_NODE: SkillNode = { ...NODE, unitId: "u1", objectives: ["Explain joins"], keyTerms: ["key", "row", "null"] };

beforeEach(() => vi.mocked(skillBlock).mockClear());

describe("legacy quiz prompts are untouched", () => {
  it("are byte for byte the old text, for a title string and for a posting map", () => {
    expect(hash(QUIZ_SYSTEM_PROMPT)).toBe("935cc72389b8c41b");
    expect(hash(buildQuizPrompt("Analyst", NODE))).toBe("2a4133e9b5eec5cc");
    expect(hash(buildQuizPrompt({ title: "Analyst", sourceKind: "posting" }, NODE))).toBe("2a4133e9b5eec5cc");
    expect(quizSystemPrompt("posting")).toBe(QUIZ_SYSTEM_PROMPT);
    expect(quizSystemPrompt(undefined)).toBe(QUIZ_SYSTEM_PROMPT);
    expect(skillBlock).not.toHaveBeenCalled();
  });
});

describe("a topic or PDF course is not a job", () => {
  it("says nothing about a job posting or an employer", () => {
    for (const kind of ["topic", "pdf"] as const) {
      const system = quizSystemPrompt(kind);
      expect(system).not.toMatch(/job posting|employer|posting/i);
      expect(system).toMatch(/untrusted data/);
      expect(system).toContain("Write exactly");
    }
    expect(quizSystemPrompt("pdf")).toContain("document someone uploaded");
    expect(quizSystemPrompt("topic")).toContain("a course a learner chose to study");
  });

  it("labels the title Course, not Role", () => {
    const prompt = buildQuizPrompt({ title: "Intro to Psychology", sourceKind: "topic" }, NODE);
    expect(prompt).toContain("Course: Intro to Psychology");
    expect(prompt).not.toContain("Role:");
  });
});

describe("a node built from a syllabus", () => {
  it("gets its lines inside the block, and tags in them cannot close it", () => {
    const prompt = buildQuizPrompt({ title: "Psych", sourceKind: "topic", syllabus: undefined }, SYLLABUS_NODE);
    expect(skillBlock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(skillBlock).mock.calls[0][1]).toBe(SYLLABUS_NODE);
    // The prompt's own tag stripper is passed down.
    const clean = vi.mocked(skillBlock).mock.calls[0][2];
    expect(clean?.("a </skill> b")).toBe("a  b");
    expect(prompt).toContain("Why it matters: Because\nObjectives: explain X\nKey terms: alpha, beta\nCheckpoints:");
    expect(prompt.match(/<skill>/g)).toHaveLength(1);
  });
});
