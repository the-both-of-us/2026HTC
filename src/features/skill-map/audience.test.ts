import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { generateSkillMap } from "./generate";
import {
  buildCoursePrompt,
  COURSE_SYSTEM_PROMPT,
  courseSystemPrompt,
  MAP_SYSTEM_PROMPT,
  PDF_SYSTEM_PROMPT,
  pdfSystemPrompt,
  TOPIC_SYSTEM_PROMPT,
  topicSystemPrompt,
} from "./prompt";
import { getSkillMap, toPublicMap } from "./storage";

vi.mock("@/features/ai", () => ({ chatJSON: vi.fn() }));

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const GRADE_1 = "Grade 1 students (about 6 years old)";

const topicReply = {
  isTopic: true,
  title: "Counting to 100",
  nodes: ["count-to-10", "count-to-20", "count-by-tens", "count-to-100", "count-on"].map((id, index, ids) => ({
    id,
    title: id,
    why: "You count your toys.",
    prerequisites: index ? [ids[index - 1]] : [],
    checkpoints: ["Each thing gets counted exactly once.", "The last number says how many.", "Ten ones make one ten."],
  })),
};

beforeEach(() => {
  vi.mocked(chatJSON).mockReset();
});

describe("prompts with no audience", () => {
  it("are byte for byte the prompts from before audiences, so the eval baseline still holds", () => {
    // Hashes of the prompts on main before this change (0c9ed46).
    expect(hash(TOPIC_SYSTEM_PROMPT)).toBe("77299601eb0036f6");
    expect(hash(PDF_SYSTEM_PROMPT)).toBe("a936dfb27353d455");
    expect(hash(COURSE_SYSTEM_PROMPT)).toBe("0127ac746c31e5db");
    expect(hash(MAP_SYSTEM_PROMPT)).toBe("9d4b46ce0033dcd7");
    expect(hash(buildCoursePrompt({ programTitle: "P", courseTitle: "C", courseSummary: "S", otherCourses: ["A", "B"] }))).toBe(
      "17613e22a6a0d05d",
    );
    expect(topicSystemPrompt("")).toBe(TOPIC_SYSTEM_PROMPT);
    expect(pdfSystemPrompt()).toBe(PDF_SYSTEM_PROMPT);
    expect(courseSystemPrompt(undefined)).toBe(COURSE_SYSTEM_PROMPT);
  });
});

describe("prompts with an audience", () => {
  it("pitch topics and checkpoints at that level, judged by a teacher, not a coworker", () => {
    for (const system of [topicSystemPrompt(GRADE_1), courseSystemPrompt(GRADE_1), pdfSystemPrompt(GRADE_1)]) {
      expect(system).toContain(`AUDIENCE\nThese learners are: ${GRADE_1}.`);
      expect(system).toContain("a good teacher at that level would say");
      expect(system).toContain("It must not be obvious to a learner at that level who has not learned it yet.");
      expect(system).toContain("never \"Counting uses one-to-one correspondence\"");
      expect(system).not.toMatch(/new coworker|senior person|at any employer|well at work|LEFT JOIN/);
    }
    expect(courseSystemPrompt(GRADE_1)).toContain("Write 6 to 10 nodes");
  });

  it("tell a course which audience its program is for", () => {
    const prompt = buildCoursePrompt({ programTitle: "Grade 1 math", courseTitle: "Shapes", courseSummary: "S", otherCourses: ["A"], audience: GRADE_1 });
    expect(prompt).toContain(`The program is for: ${GRADE_1}\n</program>`);
  });
});

describe("maps and their audience", () => {
  it("pitches a topic that names a grade, and saves the audience on the map", async () => {
    vi.mocked(chatJSON).mockResolvedValue(topicReply);
    const map = await generateSkillMap({ text: "grade 1 math", kind: "topic", ownerId: "owner-1" });
    expect(vi.mocked(chatJSON).mock.calls[0][0].system).toBe(topicSystemPrompt(GRADE_1));
    expect(map.audience).toBe(GRADE_1);
    expect((await getSkillMap(map.id))?.audience).toBe(GRADE_1);
    expect(toPublicMap(map).audience).toBe(GRADE_1);
  });

  it("uses the audience the plan gave, ahead of the fallback", async () => {
    vi.mocked(chatJSON).mockResolvedValue(topicReply);
    const map = await generateSkillMap({ text: "counting", kind: "topic", ownerId: "o", audience: "Kindergarten children (about 5 years old)" });
    expect(map.audience).toBe("Kindergarten children (about 5 years old)");
  });

  it("leaves an adult topic exactly as before, with no audience field", async () => {
    vi.mocked(chatJSON).mockResolvedValue({ ...topicReply, title: "SQL window functions" });
    const map = await generateSkillMap({ text: "SQL window functions", kind: "topic", ownerId: "o" });
    expect(vi.mocked(chatJSON).mock.calls[0][0].system).toBe(TOPIC_SYSTEM_PROMPT);
    expect("audience" in map).toBe(false);
    expect("audience" in toPublicMap(map)).toBe(false);
  });

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
