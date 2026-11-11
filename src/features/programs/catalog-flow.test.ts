/**
 * The shared catalog end to end, on the in-memory store with the AI scripted: a program and a
 * single course that are the same subject share one catalog course and one syllabus, in either
 * order and under concurrent requests; opening a course makes no model call; planning shows as it
 * streams; and "Delete my data" never touches canonical content.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, chatJSON, streamLines, type ChatJsonOptions, type StreamLinesOptions } from "@/features/ai";
import { ensureLesson } from "@/features/lessons";
import { catalogKeys, getCatalogCourse, getCatalogProgram, readCatalogProgram } from "@/features/catalog";
import { ensureUnitNodes, getSkillMap, saveSkillMap } from "@/features/skill-map";
import { deleteUserData } from "@/features/trust";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { createCourseMap, createProgramOrMap, getProgramView, openCourse, resumePlanning, startUnit } from "./programs";
import { getProgram } from "./storage";
import { degreeFrameLines, fakeStreamLines, psychologyPlanLines, syllabusLines, unitNodes } from "./test-fixtures";

const { afters } = vi.hoisted(() => {
  const queue: (() => unknown)[] = [];
  return {
    afters: {
      queue,
      /** Runs every queued after() task one by one (and any they queue), like a server would after each response. */
      async drain() {
        while (queue.length > 0) await queue.shift()!();
      },
      /** Runs everything queued so far at the same time, as separate requests' after() tasks would. */
      async drainTogether() {
        while (queue.length > 0) await Promise.all(queue.splice(0).map((task) => task()));
      },
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    afters.queue.push(task);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  streamLines: vi.fn(),
  chatJSON: vi.fn(),
}));
vi.mock("@/features/lessons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/lessons")>()),
  writeFirstLessonSoon: vi.fn(),
  ensureLesson: vi.fn(async () => "ready"),
}));
// Unit nodes and the learner map's attached syllabus belong to skill-map (WP-C). Here they do
// what its contract says: build the unit cache once, and attach the catalog syllabus on read.
vi.mock("@/features/skill-map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/skill-map")>();
  const fixtures = await import("./test-fixtures");
  const catalog = await import("@/features/catalog");
  const store = await import("@/shared/store");
  return {
    ...actual,
    ensureUnitNodes: vi.fn(async (input: { contentId: string; unitId: string; syllabus: { units: { id: string; topics: { id: string }[] }[] } }) => {
      const key = `unit-nodes/${input.contentId}/${input.unitId}`;
      const cached = await store.getDoc<{ nodes: SkillMap["nodes"] }>(key);
      if (cached) return { status: "ready", nodes: cached.nodes };
      const unit = input.syllabus.units.find((u) => u.id === input.unitId)!;
      const nodes = fixtures.unitNodes(unit.topics.map((t) => t.id));
      await fixtures.writeUnitCache(input.contentId, input.unitId, nodes);
      return { status: "ready", nodes };
    }),
    syncCourseMap: vi.fn(async (map: SkillMap) => ({ map, build: null })),
    getSkillMap: vi.fn(async (id: string) => {
      const map = await actual.getSkillMap(id);
      if (!map?.courseId || map.syllabus) return map;
      const read = await catalog.readCatalogSyllabus(map.courseId);
      if (read.state === "idle") return map;
      const ids = new Set(map.nodes.map((n) => n.id));
      const units = read.syllabus.units.map((u) => ({ ...u, built: u.topics.some((t) => ids.has(t.id)) }));
      return { ...map, syllabus: { ...read.syllabus, units } };
    }),
  };
});

const mockStream = vi.mocked(streamLines);
const mockChat = vi.mocked(chatJSON);
const mockUnits = vi.mocked(ensureUnitNodes);
let calls: Record<string, number> = {};

/** The model, scripted: plans, syllabi and the resolver's picks. */
function scriptAi() {
  calls = {};
  mockStream.mockImplementation(
    fakeStreamLines((options: StreamLinesOptions<unknown>) => {
      calls[options.label] = (calls[options.label] ?? 0) + 1;
      if (options.label === "short-plan") return psychologyPlanLines();
      if (options.label === "degree-frame") return degreeFrameLines();
      if (options.label === "syllabus") return syllabusLines(/slug: ([a-z0-9-]+)/.exec(options.prompt)![1]);
      return null;
    }),
  );
  mockChat.mockImplementation((async (options: ChatJsonOptions<unknown>) => {
    calls[options.label] = (calls[options.label] ?? 0) + 1;
    if (options.label !== "catalog-resolve") throw new Error(`unexpected call ${options.label}`);
    if (options.prompt.includes("<lines>")) return { picks: [] };
    if (options.system?.includes("[program] or [course]")) return { pick: 0, broad: true, title: "Psychology", summary: "Understand people." };
    if (options.system?.includes("existing programs")) return { pick: 0, title: "Psychology", summary: "Understand people." };
    const numbered = options.prompt.split("\n").filter((line) => /^\d+\. /.test(line));
    const pick = numbered.findIndex((line) => line.includes("Introduction to psychology")) + 1;
    return { pick, title: "Introduction to psychology", summary: "Know the field and its methods." };
  }) as never);
}

const A = randomUUID();
const B = randomUUID();
const C = randomUUID();

async function planPsychology(owner: string, depth?: "degree") {
  const result = await createProgramOrMap({ text: "psychology", kind: "topic", shape: "program", ownerId: owner, ...(depth && { depth }) });
  return (result as { programId: string }).programId;
}

async function foundations(owner: string) {
  return (await createCourseMap({ text: "Foundations of psychology", ownerId: owner })).mapId;
}

async function courseIdOfMap(mapId: string) {
  return (await getSkillMap(mapId))!.courseId!;
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  afters.queue.length = 0;
  mockStream.mockReset();
  mockChat.mockReset();
  mockUnits.mockClear();
  vi.mocked(ensureLesson).mockClear();
  scriptAi();
});

describe("one course, whoever asks first (the owner's psychology case)", () => {
  it("program first: 'Foundations of psychology' alone lands on the program's intro course and its syllabus", async () => {
    const programId = await planPsychology(A);
    await afters.drain();
    const program = (await getProgram(programId))!;
    expect(program.courses).toHaveLength(5);
    const intro = program.courses[0];
    expect(intro).toMatchObject({ title: "Introduction to psychology", courseId: expect.any(String) });
    // Rule 1: course 1's syllabus and unit 1 were built right after the frame.
    expect(calls.syllabus).toBe(1);
    expect(await getDoc(catalogKeys.syllabus(intro.courseId!))).not.toBeNull();
    expect(await getDoc(`unit-nodes/${intro.courseId}/u1`)).not.toBeNull();
    // Rule 2: the first topic's lesson, written once on the canonical course (no learner map needed).
    expect(vi.mocked(ensureLesson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ensureLesson).mock.calls[0][0]).toMatchObject({ contentId: intro.courseId, node: { prerequisites: [] } });

    const mapId = await foundations(B);
    await afters.drain();
    expect(await courseIdOfMap(mapId)).toBe(intro.courseId);
    expect(calls.syllabus).toBe(1);
    expect(await listKeys("catalog/syllabi/")).toHaveLength(1);
    // The course keeps its home in the program, so its syllabus was planned in that context.
    expect(await getCatalogCourse(intro.courseId!)).toMatchObject({ homeProgramId: program.catalogId, homeSlug: "intro-psychology" });
  });

  it("course first: the program planned later reuses that course, its syllabus and its unit 1", async () => {
    const mapId = await foundations(B);
    await afters.drain();
    const courseId = await courseIdOfMap(mapId);
    expect(calls.syllabus).toBe(1);
    expect(await getCatalogCourse(courseId)).toMatchObject({ title: "Introduction to psychology" });

    const programId = await planPsychology(A);
    await afters.drain();
    const program = (await getProgram(programId))!;
    expect(program.courses[0].courseId).toBe(courseId);
    const opened = await openCourse(programId, program.courses[0].slug, A);
    await afters.drain();
    expect(opened.status).toBe("ready");
    expect(await courseIdOfMap((opened as { mapId: string }).mapId)).toBe(courseId);
    // Only course 2 (rule 5, the next course) got a new syllabus; course 1's was reused.
    expect(await listKeys("catalog/syllabi/")).toHaveLength(2);
    expect(calls.syllabus).toBe(2);
    expect((await getCatalogCourse(courseId))!.homeProgramId).toBeUndefined();
  });

  it("at the same moment: three requests, one course, one syllabus generation", async () => {
    const [programId, mapB, mapC] = await Promise.all([planPsychology(A), foundations(B), foundations(C)]);
    await afters.drainTogether();
    const courseB = await courseIdOfMap(mapB);
    expect(await courseIdOfMap(mapC)).toBe(courseB);
    expect((await getProgram(programId))!.courses[0].courseId).toBe(courseB);
    expect(calls.syllabus).toBe(1);
    expect(await listKeys("catalog/syllabi/")).toHaveLength(1);
    expect(await listKeys("catalog/courses/")).toHaveLength(5);
  });

  it("two people planning the same program share one frame, planned once", async () => {
    const [first, second] = await Promise.all([planPsychology(A), planPsychology(B)]);
    await afters.drainTogether();
    const [p1, p2] = [(await getProgram(first))!, (await getProgram(second))!];
    expect(p1.catalogId).toBe(p2.catalogId);
    expect(calls["short-plan"]).toBe(1);
    expect(p2.courses.map((c) => c.courseId)).toEqual(p1.courses.map((c) => c.courseId));
  });
});

describe("opening and unlocking", () => {
  it("opens a course with zero model calls, and the next one opens at a quarter of the first", async () => {
    const programId = await planPsychology(A);
    await afters.drain();
    const program = (await getProgram(programId))!;
    const before = { ...calls };
    const opened = (await openCourse(programId, "intro-psychology", A)) as { status: "ready"; mapId: string };
    expect(calls).toEqual(before);
    expect(opened.status).toBe("ready");
    const map = (await getSkillMap(opened.mapId))!;
    expect(map).toMatchObject({ courseId: program.courses[0].courseId, nodes: [], program: { id: programId, courseNumber: 1 } });
    // Opening again (a double click) gives the same map.
    expect(await openCourse(programId, "intro-psychology", A)).toEqual(opened);

    await expect(openCourse(programId, "research-methods", A)).rejects.toMatchObject({ status: 409 });
    // Unit 1 and unit 2 on the map (as syncCourseMap and a unit start would append them), then proofs.
    const syllabus = map.syllabus!;
    const ids = syllabus.units.slice(0, 2).flatMap((u) => u.topics.map((t) => t.id));
    await saveSkillMap({ ...(await getSkillMap(opened.mapId))!, nodes: unitNodes(ids) });
    const planned = syllabus.units.reduce((sum, u) => sum + u.topics.length, 0);
    const quarter = Math.ceil(planned / 4);
    for (const nodeId of ids.slice(0, quarter - 1)) await putDoc(`progress/${opened.mapId}/${A}/${nodeId}`, { nodeId, attemptId: "x", provenAt: new Date().toISOString() });
    const view = (await getProgramView(programId, A))!;
    expect(view.courses[1]).toMatchObject({ state: "locked", blockers: [{ title: "Introduction to psychology", needed: 1 }] });
    await putDoc(`progress/${opened.mapId}/${A}/${ids[quarter - 1]}`, { nodeId: ids[quarter - 1], attemptId: "x", provenAt: new Date().toISOString() });
    expect((await getProgramView(programId, A))!.courses[1].state).toBe("open");
  });

  it("keeps Start off for a course line not registered yet, and shows planning progress while the frame streams", async () => {
    // A claimed program whose planner is mid-stream: two course lines, one registered.
    mockChat.mockImplementationOnce((async () => ({ pick: 0, title: "Psychology", summary: "s" })) as never);
    const programId = await planPsychology(A);
    afters.queue.length = 0;
    const { catalogId } = (await getProgram(programId))!;
    const key = catalogKeys.program(catalogId!);
    const now = new Date().toISOString();
    const [line1, line2] = psychologyPlanLines().slice(1, 3) as { slug: string; title: string; summary: string; requires: string[] }[];
    await putDoc(`claims/${key}`, { startedAt: now, heartbeatAt: now, attempt: 1 });
    await putDoc(`partial/${key}`, {
      attempt: 1,
      updatedAt: now,
      parts: [
        { kind: "head", title: "Psychology", summary: "s" },
        { kind: "course", course: { ...line1, requires: [] } },
        { kind: "course", course: line2 },
        { kind: "registered", slug: line1.slug, courseId: randomUUID() },
      ],
    });
    const view = (await getProgramView(programId, A))!;
    expect(view.planning).toEqual({ state: "planning", planned: 2, expected: null });
    expect(view.courses.map((c) => c.startable)).toEqual([true, false]);
    await expect(openCourse(programId, line2.slug, A)).rejects.toMatchObject({ status: 409 });
    expect(await resumePlanning(programId, A)).toEqual({ status: "planning" });
    expect(afters.queue).toHaveLength(0);

    // The planner died (a dead claim is minutes old, and so is the program): "stalled", and Try again restarts it.
    const old = new Date(Date.now() - 200_000).toISOString();
    const seedKey = catalogKeys.programSeed(catalogId!);
    await putDoc(seedKey, { ...(await getDoc<object>(seedKey)), createdAt: old });
    await putDoc(`claims/${key}`, { startedAt: old, heartbeatAt: old, attempt: 1 });
    expect((await getProgramView(programId, A))!.planning?.state).toBe("stalled");
    expect(await resumePlanning(programId, A)).toEqual({ status: "planning" });
    await afters.drain();
    expect((await readCatalogProgram(catalogId!))!.state).toBe("ready");
    expect((await getProgramView(programId, A))!.planning).toEqual({ state: "ready", planned: 5, expected: null });
    await expect(resumePlanning(programId, B)).rejects.toMatchObject({ status: 404 });
  });

  it("a degree plans 40 courses in years and terms, and its planning counts against 40", async () => {
    const programId = await planPsychology(A, "degree");
    // Before its planner starts (in after()), a new program reads as planning, not stalled.
    const early = (await getProgramView(programId, A))!;
    expect(early.planning).toEqual({ state: "planning", planned: 0, expected: 40 });
    await afters.drain();
    const view = (await getProgramView(programId, A))!;
    expect(view).toMatchObject({ depth: "degree", planning: { state: "ready", planned: 40, expected: 40 } });
    expect(view.courses.every((c) => c.startable && c.year && c.term && c.level)).toBe(true);
  });

  it("restarts a course's syllabus build from the unit start when it failed", async () => {
    mockStream.mockImplementation(fakeStreamLines(() => null));
    const mapId = await foundations(B);
    await afters.drain();
    expect(await getDoc(catalogKeys.syllabus(await courseIdOfMap(mapId)))).toBeNull();
    scriptAi();
    expect(await startUnit(mapId, "u1", B)).toEqual({ status: "building" });
    await afters.drain();
    expect(calls.syllabus).toBe(1);
    expect(await getDoc(catalogKeys.syllabus(await courseIdOfMap(mapId)))).not.toBeNull();
  });
});

describe("canonical data never holds a learner's raw words", () => {
  it("a failed naming call for a new course or program is the try-again error, and nothing is written", async () => {
    mockChat.mockRejectedValue(new AiUnavailableError());
    const words = "my sister Amira's favourite knitting stitches";
    await expect(createCourseMap({ text: words, ownerId: A })).rejects.toThrow("Please try again in a moment.");
    await expect(createProgramOrMap({ text: words, kind: "topic", shape: "program", ownerId: A })).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(createProgramOrMap({ text: words, kind: "topic", shape: "auto", ownerId: A })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await listKeys("catalog/")).toEqual([]);
    expect(await listKeys("maps/")).toEqual([]);
    expect(await listKeys("programs/")).toEqual([]);
    expect(afters.queue).toHaveLength(0);
  });
});

describe("postings stay private", () => {
  it("never puts a posting in the catalog, whatever the shape", async () => {
    mockChat.mockImplementation((async () => {
      throw new Error("no AI");
    }) as never);
    await expect(createProgramOrMap({ text: "We are hiring a junior backend developer to build APIs in Node and Postgres. ".repeat(3), kind: "posting", shape: "program", ownerId: A })).rejects.toThrow();
    expect(await listKeys("catalog/")).toEqual([]);
    expect(await listKeys("programs/")).toEqual([]);
  });
});

describe("Delete my data", () => {
  it("removes the learner's maps and programs but never canonical content", async () => {
    const programId = await planPsychology(A);
    await afters.drain();
    const opened = (await openCourse(programId, "intro-psychology", A)) as { mapId: string };
    await afters.drain();
    const courseId = await courseIdOfMap(opened.mapId);
    await putDoc(`lessons/${courseId}/some-topic`, { words: 1000 });
    const canonical = [
      ...(await listKeys("catalog/")),
      ...(await listKeys(`unit-nodes/${courseId}/`)),
      `lessons/${courseId}/some-topic`,
    ];

    await deleteUserData(A);
    expect(await getDoc(`maps/${opened.mapId}`)).toBeNull();
    expect(await getDoc(`programs/${programId}`)).toBeNull();
    for (const key of canonical) expect(await getDoc(key)).not.toBeNull();
    // Someone else still gets the course, with no new generation.
    const before = calls.syllabus;
    const mapId = await foundations(B);
    await afters.drain();
    expect(await courseIdOfMap(mapId)).toBe(courseId);
    expect(calls.syllabus).toBe(before);
    expect(await getCatalogProgram((await listKeys("catalog/programs/"))[0].split("/").pop()!)).toMatchObject({ status: "ready" });
  });
});
