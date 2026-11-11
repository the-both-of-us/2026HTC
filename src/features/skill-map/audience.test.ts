import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { MAP_SYSTEM_PROMPT, PDF_SYSTEM_PROMPT, pdfSystemPrompt } from "./prompt";
import { getSkillMap } from "./storage";

vi.mock("@/features/ai", () => ({ chatJSON: vi.fn() }));

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const GRADE_1 = "Grade 1 students (about 6 years old)";

beforeEach(() => {
  vi.mocked(chatJSON).mockReset();
});

describe("prompts with no audience", () => {
  it("are byte for byte the prompts from before audiences, so the eval baseline still holds", () => {
    // Hashes of the prompts on main before this change (0c9ed46).
    // The topic and course map prompts went in wave 2: topics are catalog courses built from a syllabus.
    expect(hash(PDF_SYSTEM_PROMPT)).toBe("a936dfb27353d455");
    expect(hash(MAP_SYSTEM_PROMPT)).toBe("9d4b46ce0033dcd7");
    expect(pdfSystemPrompt()).toBe(PDF_SYSTEM_PROMPT);
  });
});

describe("prompts with an audience", () => {
  it("pitch a PDF's checkpoints at that level, judged by a teacher, not a coworker", () => {
    for (const system of [pdfSystemPrompt(GRADE_1)]) {
      expect(system).toContain(`AUDIENCE\nThese learners are: ${GRADE_1}.`);
      expect(system).toContain("a good teacher at that level would say");
      expect(system).toContain("It must not be obvious to a learner at that level who has not learned it yet.");
      expect(system).toContain("never \"Counting uses one-to-one correspondence\"");
      expect(system).not.toMatch(/new coworker|senior person|at any employer|well at work|LEFT JOIN/);
    }
  });
});

describe("maps and their audience", () => {
  it("works out the audience of a map saved before audiences, from its program's title", async () => {
    const old: SkillMap = {
      id: randomUUID(),
      ownerId: "o",
      title: "Counting and numbers",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "Counting and numbers",
      nodes: [],
      createdAt: "2026-11-07T10:00:00.000Z",
      program: { id: randomUUID(), title: "Grade 1 math", courseNumber: 1, courseCount: 5, unlocks: [] },
    };
    await putDoc(`maps/${old.id}`, old);
    expect((await getSkillMap(old.id))?.audience).toBe(GRADE_1);
    await putDoc(`maps/${old.id}`, { ...old, program: undefined });
    expect((await getSkillMap(old.id))?.audience).toBeUndefined();
  });
});
