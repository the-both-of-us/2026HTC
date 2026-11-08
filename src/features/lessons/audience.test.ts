import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { getOrCreateLesson } from "./lessons";
import {
  buildLessonPrompt,
  LESSON_SYSTEM_PROMPT,
  lessonSystemPrompt,
  TARGET_WORDS,
  targetWords,
  YOUNG_TARGET_WORDS,
  type RawLesson,
} from "./prompt";
import { lessonProblem, MIN_WORDS, wordLimits } from "./validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const GRADE_1 = "Grade 1 students (about 6 years old)";
const OWNER = randomUUID();

const NODE: SkillNode = {
  id: "count-to-100",
  title: "Counting to 100",
  why: "You count your toys.",
  prerequisites: [],
  fromSource: false,
  citation: null,
  checkpoints: ["Each thing gets counted exactly once, one number for each thing.", "The last number you say tells how many."],
};

/** A lesson of about `words` words, with no code. */
function lessonOf(words: number, code: string | null = null): RawLesson {
  const sentence = "Put the blocks in a line and touch them as you go. "; // 12 words
  const part = (n: number) => sentence.repeat(Math.max(1, Math.round(n / 12)));
  return {
    idea: [part(words * 0.3), part(words * 0.3)],
    example: { intro: part(words * 0.1), code, after: part(words * 0.1) },
    mistakes: [
      { mistake: "Skipping one.", fix: part(words * 0.05) },
      { mistake: "Counting one twice.", fix: part(words * 0.05) },
      { mistake: "Losing your place.", fix: part(words * 0.05) },
    ],
    checks: [
      { question: "How many blocks?", answer: "Five." },
      { question: "Which number comes after 19?", answer: "20." },
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.mocked(chatJSON).mockReset();
});

describe("lesson prompt and audience", () => {
  it("is byte for byte the old prompt with no audience", () => {
    expect(hash(LESSON_SYSTEM_PROMPT)).toBe("df575865a7ad690a");
    expect(lessonSystemPrompt(undefined)).toBe(LESSON_SYSTEM_PROMPT);
    expect(lessonSystemPrompt("")).toBe(LESSON_SYSTEM_PROMPT);
    expect(hash(buildLessonPrompt({ title: "T" }, { ...NODE, title: "Counting to 100", why: "w", checkpoints: ["a b", "c d"], id: "n" }))).toBe(
      "3e7b6406c2c81dfb",
    );
  });

  it("asks young children for a short lesson with objects, no code and no adult framing", () => {
    const system = lessonSystemPrompt(GRADE_1);
    expect(system).toContain("- 200 to 350 words in total.");
    expect(system).not.toContain("600 to 900");
    expect(system).toContain(`The reader is: ${GRADE_1}.`);
    expect(system).toContain("code is always null");
    expect(system).toContain("never mention jobs, work, careers");
  });

  it("sets the length by age, and the checks follow it", () => {
    expect(targetWords(undefined)).toBe(TARGET_WORDS);
    expect(targetWords("High school students (about 14 to 18 years old)")).toBe(TARGET_WORDS);
    expect(targetWords(GRADE_1)).toBe(YOUNG_TARGET_WORDS);
    expect(wordLimits(TARGET_WORDS)).toEqual({ min: MIN_WORDS, max: null });
    expect(wordLimits(YOUNG_TARGET_WORDS)).toEqual({ min: 150, max: 500 });

    expect(lessonProblem(lessonOf(300), NODE.checkpoints, GRADE_1)).toBeNull();
    expect(lessonProblem(lessonOf(800), NODE.checkpoints, GRADE_1)).toMatch(/too long.*200 to 350/);
    expect(lessonProblem(lessonOf(300, "count = 1"), NODE.checkpoints, GRADE_1)).toMatch(/code must be null/);
    // Adults are unchanged: 300 words is too short, and 800 is fine.
    expect(lessonProblem(lessonOf(300), NODE.checkpoints)).toMatch(/Write 600 to 900/);
    expect(lessonProblem(lessonOf(800), NODE.checkpoints)).toBeNull();
  });
});

describe("lesson cache and audience", () => {
  it("never serves a map's adult lesson once its audience is known", async () => {
    const mapId = randomUUID();
    const map: SkillMap = {
      id: mapId,
      ownerId: OWNER,
      title: "Counting and numbers",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "Counting and numbers",
      nodes: [NODE],
      createdAt: new Date().toISOString(),
      program: { id: randomUUID(), title: "Grade 1 math", courseNumber: 1, courseCount: 4, unlocks: [] },
    };
    await putDoc(`maps/${mapId}`, map);
    // A lesson written before audiences existed, saved under the plain key.
    await putDoc(`lessons/${mapId}/${NODE.id}`, { lesson: { idea: ["ADULT"] }, createdAt: "2026-11-07T10:00:00.000Z" });
    vi.mocked(chatJSON).mockResolvedValue(lessonOf(300));

    const lesson = await getOrCreateLesson(mapId, NODE.id, OWNER);
    expect(lesson.idea[0]).not.toBe("ADULT");
    expect(vi.mocked(chatJSON).mock.calls[0][0].system).toBe(lessonSystemPrompt(GRADE_1));
    expect(await getDoc(`lessons/${mapId}/${NODE.id}/grade-1-students-about-6-years-old`)).not.toBeNull();
  });
});
