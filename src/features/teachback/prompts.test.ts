import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { skillBlock } from "@/features/skill-map";
import type { SkillMap, SkillNode } from "@/shared/types";
import { loadCatchChallenge, WRITER_SYSTEM } from "./catch";
import { createFinal, testSystem } from "./final";
import { CHECKER_SYSTEM, GRADER_SYSTEM, gradeExplanation } from "./grading";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/features/skill-map", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/skill-map")>()),
  skillBlock: vi.fn(() => ["Objectives: explain X", "Key terms: alpha, beta"]),
}));
const mockChatJSON = vi.mocked(chatJSON);

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
  nodes: [NODE, { ...NODE, id: "n2", title: "Keys" }],
  createdAt: "x",
};
const SYLLABUS_NODE: SkillNode = { ...NODE, unitId: "u1", objectives: ["Explain joins"] };

function calls() {
  return mockChatJSON.mock.calls.map(([request]) => request);
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();
  vi.mocked(skillBlock).mockClear();
});

describe("legacy teach-back prompts are untouched", () => {
  it("every system prompt is byte for byte the old text", () => {
    expect(hash(WRITER_SYSTEM)).toBe("957c1f69b76cf6f6");
    expect(hash(GRADER_SYSTEM)).toBe("e1187e09ed46fb95");
    expect(hash(CHECKER_SYSTEM)).toBe("9e5c6577847c85b9");
  });

  it("the catch and grading prompts for a legacy node are byte for byte the old text", async () => {
    mockChatJSON.mockResolvedValueOnce({
      sentences: ["a", "b", "c", "d", "e"],
      mistakes: [
        { sentence: 1, fact: 1, why: "w" },
        { sentence: 2, fact: 2, why: "w" },
      ],
    });
    await loadCatchChallenge(MAP, NODE);
    mockChatJSON.mockResolvedValueOnce({ checkpoints: [], factualErrors: [] });
    await gradeExplanation(NODE, "my explanation here", "");
    // With the map passed, a legacy node reads the same.
    mockChatJSON.mockResolvedValueOnce({ checkpoints: [], factualErrors: [] });
    await gradeExplanation(NODE, "my explanation here", "", MAP);

    const [catchCall, grade, gradeWithMap] = calls();
    expect(hash(String(catchCall.prompt))).toBe("1fa4c75d5594aa9a");
    expect(hash(String(catchCall.system))).toBe("957c1f69b76cf6f6");
    expect(hash(String(grade.prompt))).toBe("c9d8d2578699e0e6");
    expect(gradeWithMap.prompt).toBe(grade.prompt);
    expect(skillBlock).not.toHaveBeenCalled();
  });
});

describe("the multiple-choice test prompts", () => {
  /** Questions that pass every check, the correct option first. */
  const usable = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      question: `Which join keeps every row of the left table, case ${i + 1}?`,
      options: ["A left join", "An inner join", "A cross join", "A self join"],
      explanation: "A left join keeps every left row and fills gaps with NULL; an inner join keeps only matches.",
      topics: [1],
    }));

  // Pinned Nov 12, when tests became multiple choice (owner: "no written responses"); re-pinned the same day for the
  // "question holds every fact it needs" rule (a real Haiku question said "given the row values shown" with none shown). The old
  // written-final prompts (QUESTIONS_SYSTEM ee8c6ac18a6275be, ANSWER_SYSTEM 22159fdcef771bdf) were removed with them.
  it("are pinned, and a map with no syllabus gets 5 questions in one write-profile call", async () => {
    expect(hash(testSystem({ kind: "course", questions: 5 }))).toBe("a5c88ba493918e7d");
    expect(hash(testSystem({ kind: "course", questions: 10 }, true))).toBe("f3915dabc28f8300");
    expect(hash(testSystem({ kind: "unit", questions: 6 }))).toBe("5d66d22ec0c0700f");
    mockChatJSON.mockResolvedValueOnce({ questions: usable(5) });
    await createFinal(MAP, "o");
    const [call] = calls();
    expect(call.profile).toBe("write");
    expect(call.system).toBe(testSystem({ kind: "course", questions: 5 }));
    expect(hash(String(call.prompt))).toBe("ada72168ed59016a");
    expect(skillBlock).not.toHaveBeenCalled();
  });

  it("ask for 4 options with the correct one first, and shuffle them in code", () => {
    const system = testSystem({ kind: "unit", questions: 6 });
    expect(system).toContain("The FIRST option is the one correct answer");
    expect(system).toContain("exactly 6 questions on that unit only");
  });
});

describe("a node built from a syllabus", () => {
  // A fresh id, so a catch round saved by the test above is not reused.
  const syllabusMap: SkillMap = { ...MAP, id: randomUUID(), nodes: [SYLLABUS_NODE] };

  it("the catch writer sees its objectives and key terms under the topic", async () => {
    mockChatJSON.mockResolvedValueOnce({
      sentences: ["a", "b", "c", "d", "e"],
      mistakes: [
        { sentence: 1, fact: 1, why: "w" },
        { sentence: 2, fact: 2, why: "w" },
      ],
    });
    await loadCatchChallenge(syllabusMap, SYLLABUS_NODE);
    expect(calls()[0].prompt).toMatch(/^Topic: Joins\nObjectives: explain X\nKey terms: alpha, beta\n\nFacts:\n1\. Inner join/);
  });

  it("the grader sees them under the skill, and the checkpoints stay the answer key", async () => {
    mockChatJSON.mockResolvedValueOnce({ checkpoints: [], factualErrors: [] });
    await gradeExplanation(SYLLABUS_NODE, "my explanation here", "", syllabusMap);
    expect(calls()[0].prompt).toMatch(/^Skill: Joins\nObjectives: explain X\nKey terms: alpha, beta\n\nCheckpoints:\n1\. Inner join/);
  });

  it("the final's topic list shows them under each topic", async () => {
    mockChatJSON.mockResolvedValueOnce({
      questions: Array.from({ length: 5 }, (_, i) => ({
        question: `Question ${i + 1} about joins?`,
        options: ["Right", "Wrong one", "Wrong two", "Wrong three"],
        explanation: "Because.",
        topics: [1],
      })),
    });
    await createFinal(syllabusMap, "o");
    expect(calls()[0].prompt).toContain("1. Joins: Inner join keeps only matching rows; Left join");
    expect(calls()[0].prompt).toContain("\n   Objectives: explain X\n   Key terms: alpha, beta");
  });
});
