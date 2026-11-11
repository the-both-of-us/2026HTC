import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { skillBlock } from "@/features/skill-map";
import type { SkillMap, SkillNode } from "@/shared/types";
import { buildFlashcardsPrompt, FLASHCARDS_SYSTEM_PROMPT, flashcardsSystemPrompt } from "./prompt";

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
const MAP: SkillMap = {
  id: "m1",
  ownerId: "o",
  title: "Analyst",
  subtitle: "",
  sourceKind: "posting",
  sourceText: "",
  nodes: [NODE],
  createdAt: "x",
};

beforeEach(() => vi.mocked(skillBlock).mockClear());

describe("legacy flashcard prompts are untouched", () => {
  it("are byte for byte the old text for a posting map", () => {
    expect(hash(FLASHCARDS_SYSTEM_PROMPT)).toBe("33d91d37f1b135a9");
    expect(hash(buildFlashcardsPrompt(MAP, NODE))).toBe("1414193bd672ab27");
    expect(hash(buildFlashcardsPrompt({ title: "Analyst" }, NODE))).toBe("1414193bd672ab27");
    expect(flashcardsSystemPrompt("posting")).toBe(FLASHCARDS_SYSTEM_PROMPT);
    expect(flashcardsSystemPrompt(undefined)).toBe(FLASHCARDS_SYSTEM_PROMPT);
    expect(skillBlock).not.toHaveBeenCalled();
  });
});

describe("a topic or PDF course is not a job", () => {
  it("the system prompt does not mention a job, an employer or a posting", () => {
    for (const kind of ["topic", "pdf"] as const) {
      const system = flashcardsSystemPrompt(kind);
      expect(system).not.toMatch(/\bjob\b|employer|posting/i);
      expect(system).toMatch(/untrusted data/);
      expect(system).toContain("Write 6 to 8 cards");
    }
    expect(flashcardsSystemPrompt("pdf")).toContain("document a user uploaded");
  });

  it("the data block says Course and Why it matters", () => {
    const prompt = buildFlashcardsPrompt({ ...MAP, title: "Intro to Psychology", sourceKind: "topic" }, NODE);
    expect(prompt).toContain("Course: Intro to Psychology");
    expect(prompt).toContain("Why it matters: Because");
    expect(prompt).not.toMatch(/Job:|the job needs/);
  });
});

describe("a node built from a syllabus", () => {
  it("gets its lines inside the block, before the checkpoints", () => {
    const node: SkillNode = { ...NODE, unitId: "u1", objectives: ["Explain joins"] };
    const prompt = buildFlashcardsPrompt({ ...MAP, sourceKind: "topic" }, node);
    expect(skillBlock).toHaveBeenCalledTimes(1);
    expect(prompt).toContain("Why it matters: Because\nObjectives: explain X\nKey terms: alpha, beta\nCheckpoints:");
    expect(prompt.match(/<\/skill>/g)).toHaveLength(1);
  });
});
