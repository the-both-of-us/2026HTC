import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getSkillMap } from "@/features/skill-map";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { putDoc } from "@/shared/store";
import { cleanPlan, type RawPlan } from "./plan";
import { createProgramOrMap, getProgramView, openCourse } from "./programs";
import { deleteProgramsByOwner, getProgram, listMyPrograms } from "./storage";
import { courseStates } from "./unlock";

vi.mock("@/features/ai", () => ({ chatJSON: vi.fn() }));

const SAMPLE = SAMPLE_POSTINGS.find((sample) => sample.id === "junior-backend")!.text;

const course = (slug: string, requires: string[] = []) => ({ slug, title: slug, summary: "Learn it.", requires });
const plan = (overrides: Partial<RawPlan> = {}): RawPlan => ({
  isLearnable: true,
  isBroad: true,
  title: "Web development",
  summary: "From first page to live site.",
  courses: [course("html"), course("css", ["html"]), course("js", ["css"]), course("react", ["js"])],
  ...overrides,
});

async function proveFirst(mapId: string, ownerId: string, count: number) {
  const map = (await getSkillMap(mapId))!;
  for (const node of map.nodes.slice(0, count)) {
    await putDoc(`progress/${mapId}/${ownerId}/${node.id}`, { nodeId: node.id, attemptId: randomUUID(), provenAt: "2026-11-07T10:00:00.000Z" });
  }
}

beforeEach(() => {
  vi.mocked(chatJSON).mockReset();
  vi.mocked(chatJSON).mockRejectedValue(new Error("No AI in tests"));
});

describe("cleanPlan", () => {
  it("keeps unique slugs, and only lets a course require one before it", () => {
    const clean = cleanPlan(
      plan({
        courses: [course("html", ["react"]), course("html"), course("css", ["css", "nope"]), course("js", ["html", "css"])],
      }),
    );
    expect(clean.courses.map((c) => [c.slug, c.requires])).toEqual([
      ["html", []],
      ["css", ["html"]],
      ["js", ["html", "css"]],
    ]);
  });

  it("stops at 8 courses, and refuses too few or something unlearnable", () => {
    const many = Array.from({ length: 12 }, (_, i) => course(`c${i}`));
    expect(cleanPlan(plan({ courses: many })).courses).toHaveLength(8);
    expect(() => cleanPlan(plan({ courses: [course("a"), course("b")] }))).toThrow("could not plan a full program");
    expect(() => cleanPlan(plan({ isLearnable: false }))).toThrow("could not plan a program");
  });
});

describe("courseStates", () => {
  it("opens a course once half of what it requires is proved", () => {
    const courses = [course("a"), course("b", ["a"]), course("c", ["b"])];
    expect(courseStates(courses, {}).b).toEqual({ state: "locked", blockers: [{ title: "a", needed: null }] });
    expect(courseStates(courses, { a: { proven: 2, total: 8 } }).b.blockers).toEqual([{ title: "a", needed: 2 }]);
    const half = courseStates(courses, { a: { proven: 4, total: 8 } });
    expect(half.b.state).toBe("open");
    expect(courseStates(courses, { a: { proven: 8, total: 8 } }).a.state).toBe("done");
  });
});

describe("programs", () => {
  it("plans the sample posting from its saved plan, with no AI call", async () => {
    const owner = randomUUID();
    const result = await createProgramOrMap({ text: SAMPLE, kind: "posting", shape: "program", ownerId: owner });

    expect(chatJSON).not.toHaveBeenCalled();
    expect("programId" in result).toBe(true);
    const view = (await getProgramView((result as { programId: string }).programId, owner))!;
    expect(view.isSample).toBe(true);
    expect(view.courses.length).toBeGreaterThanOrEqual(4);
    expect(view.courses[0].state).toBe("open");
    expect(view.courses[1].state).toBe("locked");
    // Nothing private reaches the browser.
    expect(JSON.stringify(view)).not.toContain(owner);
    expect(view).not.toHaveProperty("sourceText");
  });

  it("keeps a narrow topic as one course on auto, and plans a program when asked", async () => {
    vi.mocked(chatJSON).mockResolvedValueOnce(plan({ isBroad: false }));
    vi.mocked(chatJSON).mockRejectedValueOnce(new Error("map call"));
    await expect(
      createProgramOrMap({ text: "photosynthesis", kind: "topic", shape: "auto", ownerId: randomUUID() }),
    ).rejects.toThrow("map call");

    vi.mocked(chatJSON).mockResolvedValueOnce(plan({ isBroad: false }));
    const result = await createProgramOrMap({ text: "photosynthesis", kind: "topic", shape: "program", ownerId: randomUUID() });
    expect(result).toHaveProperty("programId");
  });

  it("builds a course once, even when opened twice at the same moment", async () => {
    const owner = randomUUID();
    const { programId } = (await createProgramOrMap({ text: SAMPLE, kind: "posting", shape: "program", ownerId: owner })) as {
      programId: string;
    };
    const first = (await getProgram(programId))!.courses[0].slug;

    const [a, b] = await Promise.all([openCourse(programId, first, owner), openCourse(programId, first, owner)]);
    const ready = [a, b].filter((r) => r.status === "ready");
    expect(new Set(ready.map((r) => (r as { mapId: string }).mapId)).size).toBe(1);
    expect(chatJSON).not.toHaveBeenCalled();

    const again = await openCourse(programId, first, owner);
    expect(again).toEqual(ready[0]);
    const map = (await getSkillMap((again as { mapId: string }).mapId))!;
    expect(map.ownerId).toBe(owner);
    expect(map.program).toMatchObject({ id: programId, courseNumber: 1 });
    expect(map.nodes.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps later courses locked until half the first is proved", async () => {
    const owner = randomUUID();
    const { programId } = (await createProgramOrMap({ text: SAMPLE, kind: "posting", shape: "program", ownerId: owner })) as {
      programId: string;
    };
    const [first, second] = (await getProgram(programId))!.courses;
    await expect(openCourse(programId, second.slug, owner)).rejects.toThrow("first, and this course opens");

    const { mapId } = (await openCourse(programId, first.slug, owner)) as { mapId: string };
    const total = (await getSkillMap(mapId))!.nodes.length;
    await proveFirst(mapId, owner, Math.ceil(total / 2));

    const view = (await getProgramView(programId, owner))!;
    expect(view.courses[0]).toMatchObject({ proven: Math.ceil(total / 2), total, state: "open" });
    expect(view.courses[1].state).toBe("open");
  });

  it("gives the course badge only once the final interview is passed, as the map says", async () => {
    const owner = randomUUID();
    const { programId } = (await createProgramOrMap({ text: SAMPLE, kind: "posting", shape: "program", ownerId: owner })) as {
      programId: string;
    };
    const [first] = (await getProgram(programId))!.courses;
    const { mapId } = (await openCourse(programId, first.slug, owner)) as { mapId: string };
    await proveFirst(mapId, owner, (await getSkillMap(mapId))!.nodes.length);

    const done = (await getProgramView(programId, owner))!.courses[0];
    expect(done).toMatchObject({ state: "done", badge: false });

    const result = { passed: true, passedCount: 2, spokenCount: 0, finishedAt: "2026-11-07T11:00:00.000Z" };
    await putDoc(`final/${mapId}`, { mapId, ownerId: owner, attemptIds: [], topics: [], startedAt: "", result });
    expect((await getProgramView(programId, owner))!.courses[0]).toMatchObject({ state: "done", badge: true });
  });

  it("is private to its owner, and goes with Delete my data", async () => {
    const owner = randomUUID();
    const { programId } = (await createProgramOrMap({ text: SAMPLE, kind: "posting", shape: "program", ownerId: owner })) as {
      programId: string;
    };
    await expect(getProgramView(programId, randomUUID())).rejects.toThrow("private");
    await expect(getProgramView(programId, null)).rejects.toThrow("private");
    await expect(openCourse(programId, "anything", randomUUID())).rejects.toThrow("private");

    const [row] = await listMyPrograms(owner);
    expect(row).toMatchObject({ id: programId, href: `/program/${programId}` });
    expect(JSON.stringify(row)).not.toContain(owner);

    expect(await deleteProgramsByOwner(owner)).toBe(1);
    expect(await getProgramView(programId, owner)).toBeNull();
  });
});
