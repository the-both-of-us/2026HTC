import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getSkillMap } from "@/features/skill-map";
import { putDoc } from "@/shared/store";
import { planAudience, PLAN_SYSTEM_PROMPT, type RawPlan } from "./plan";
import { createProgramOrMap, openCourse, programAudience } from "./programs";
import { getProgram } from "./storage";
import type { Program } from "./types";

vi.mock("@/features/ai", () => ({ chatJSON: vi.fn() }));

const GRADE_1 = "Grade 1 students (about 6 years old)";
const course = (slug: string, requires: string[] = []) => ({ slug, title: slug, summary: "Learn it.", requires });
const plan = (overrides: Partial<RawPlan> = {}): RawPlan => ({
  isLearnable: true,
  isBroad: true,
  title: "Grade 1 math",
  summary: "Numbers, shapes and time.",
  courses: [course("counting"), course("adding", ["counting"]), course("shapes", ["adding"]), course("time", ["shapes"])],
  ...overrides,
});
const courseReply = {
  isTopic: true,
  title: "Counting",
  nodes: ["a", "b", "c", "d", "e"].map((id, index, ids) => ({
    id,
    title: `Topic ${id}`,
    why: "You count your toys.",
    prerequisites: index ? [ids[index - 1]] : [],
    checkpoints: ["Each thing gets counted exactly once.", "The last number says how many.", "Ten ones make one ten."],
  })),
};

beforeEach(() => vi.mocked(chatJSON).mockReset());

describe("program audience", () => {
  it("asks the planner for an audience, and falls back to the grade the topic names", () => {
    expect(PLAN_SYSTEM_PROMPT).toContain("AUDIENCE\n- audience:");
    expect(planAudience({ audience: GRADE_1 }, "grade 1 math", "topic")).toBe(GRADE_1);
    expect(planAudience({ audience: "" }, "grade 1 math", "topic")).toBe(GRADE_1);
    expect(planAudience({}, "web development", "topic")).toBe("");
    // A posting for a grade 1 teacher is for the teacher.
    expect(planAudience({ audience: GRADE_1 }, "Grade 1 teacher wanted", "posting")).toBe("");
  });

  it("saves it on the program, and every course map inherits it", async () => {
    const owner = randomUUID();
    vi.mocked(chatJSON).mockResolvedValueOnce(plan({ audience: GRADE_1 }));
    const { programId } = (await createProgramOrMap({ text: "grade 1 math", kind: "topic", shape: "auto", ownerId: owner })) as {
      programId: string;
    };
    expect((await getProgram(programId))?.audience).toBe(GRADE_1);

    vi.mocked(chatJSON).mockResolvedValueOnce(courseReply);
    const opened = (await openCourse(programId, "counting", owner)) as { mapId: string };
    const call = vi.mocked(chatJSON).mock.calls[1][0];
    expect(call.system).toContain(`AUDIENCE\nThese learners are: ${GRADE_1}.`);
    expect(call.prompt).toContain(`The program is for: ${GRADE_1}`);
    expect((await getSkillMap(opened.mapId))?.audience).toBe(GRADE_1);
  });

  it("keeps a narrow topic as one map, pitched at the plan's audience", async () => {
    vi.mocked(chatJSON).mockResolvedValueOnce(plan({ isBroad: false, audience: GRADE_1 })).mockResolvedValueOnce(courseReply);
    const { mapId } = (await createProgramOrMap({ text: "counting to 100 grade 1", kind: "topic", shape: "auto", ownerId: "o" })) as {
      mapId: string;
    };
    expect((await getSkillMap(mapId))?.audience).toBe(GRADE_1);
  });

  it("gives an adult program no audience, and works one out for a program saved before audiences", async () => {
    vi.mocked(chatJSON).mockResolvedValueOnce(plan({ title: "Web development" }));
    const { programId } = (await createProgramOrMap({ text: "web development", kind: "topic", shape: "program", ownerId: "o" })) as {
      programId: string;
    };
    expect("audience" in (await getProgram(programId))!).toBe(false);

    const old: Program = {
      id: randomUUID(),
      ownerId: "o",
      title: "Grade 1 math",
      summary: "",
      sourceKind: "topic",
      sourceText: "grade 1 math",
      courses: [course("counting")],
      createdAt: "2026-11-07T10:00:00.000Z",
    };
    await putDoc(`programs/${old.id}`, old);
    expect(programAudience((await getProgram(old.id))!)).toBe(GRADE_1);
    expect(programAudience({ ...old, title: "Web development", sourceText: "web development" })).toBe("");
  });
});
