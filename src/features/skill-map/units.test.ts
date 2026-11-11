import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { readCatalogSyllabus } from "@/features/catalog";
import { getDoc, putDoc } from "@/shared/store";
import type { CourseSyllabus, SkillMap, SyllabusTopic } from "@/shared/types";
import { contentIdOf, syncCourseMap } from "./canonical";
import { buildUnitPrompt, UNIT_SYSTEM_PROMPT, unitSystemPrompt, type RawUnitNode } from "./prompt";
import { copySkillMap, getSkillMap, saveSkillMap, toPublicMap } from "./storage";
import { fakeRunning } from "@/shared/store/onceFake";
import { ensureUnitNodes, generateUnit, isUnitBuilt, STALE_UNIT_CLAIM_MS } from "./units";
import { NODE_LIMITS, validateUnitNodes } from "./validate";

vi.mock("@/features/ai", () => ({ chatJSON: vi.fn() }));
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));
vi.mock("@/features/catalog", () => ({
  readCatalogSyllabus: vi.fn(),
  getCatalogCourse: vi.fn(async (id: string) => ({
    id,
    title: "Introduction to Psychology",
    summary: "The field.",
    audience: "",
    homeProgramId: "prog-1",
    homeSlug: "intro-psych",
    createdAt: "2026-11-11T00:00:00.000Z",
  })),
  getCatalogProgram: vi.fn(async () => ({ title: "Psychology" })),
}));
/** `after()` callbacks, so a test can run what a request left for after the response. */
const afterTasks: (() => Promise<unknown>)[] = [];
vi.mock("next/server", () => ({ after: (task: () => Promise<unknown>) => void afterTasks.push(task) }));
async function runAfterTasks() {
  while (afterTasks.length) await afterTasks.shift()!();
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

function topic(id: string, overrides: Partial<SyllabusTopic> = {}): SyllabusTopic {
  return {
    id,
    title: `Title of ${id}`,
    objectives: [`Explain ${id}`, `Apply ${id}`],
    keyTerms: [`${id}-a`, `${id}-b`, `${id}-c`],
    inScope: `What ${id} covers.`,
    outOfScope: `What ${id} leaves out.`,
    buildsOn: [],
    ...overrides,
  };
}

function makeSyllabus(): CourseSyllabus {
  return {
    version: 1,
    depth: "degree",
    courseSlug: "intro-psych",
    level: 100,
    outcomes: [
      { id: "o1", text: "Describe the science of behaviour" },
      { id: "o2", text: "Explain how neurons communicate" },
      { id: "o3", text: "Compare theories of learning" },
      { id: "o4", text: "Read a simple study" },
    ],
    units: [
      {
        id: "u1",
        title: "Foundations",
        outcomeIds: ["o1"],
        built: false,
        topics: [topic("what-is-psych"), topic("history", { buildsOn: ["what-is-psych"] }), topic("methods"), topic("ethics")],
      },
      {
        id: "u2",
        title: "Biological bases",
        outcomeIds: ["o2", "o4"],
        built: false,
        topics: [topic("neurons", { buildsOn: ["intro-psych:what-is-psych"] }), topic("synapses", { buildsOn: ["neurons"] }), topic("brain-areas"), topic("hormones")],
      },
      {
        id: "u3",
        title: "Learning",
        outcomeIds: ["o3"],
        built: false,
        topics: [topic("classical"), topic("operant"), topic("observational")],
      },
    ],
    assessment: { unitTests: true, finalQuestions: 6 },
  };
}

const CHECKPOINTS = ["First fact here.", "Second fact here.", "Third fact here.", "Fourth fact here."];

function unitReply(ids: string[], extra: RawUnitNode[] = []) {
  return {
    nodes: [
      ...ids.map((id, index) => ({
        id,
        why: `You use ${id}.`,
        prerequisites: index ? [ids[index - 1]] : [],
        checkpoints: CHECKPOINTS,
      })),
      ...extra,
    ],
  };
}

beforeEach(() => {
  vi.mocked(chatJSON).mockReset();
  vi.mocked(readCatalogSyllabus).mockReset();
  vi.mocked(readCatalogSyllabus).mockResolvedValue({ state: "ready", syllabus: makeSyllabus() });
  afterTasks.length = 0;
  delete process.env.BLOB_READ_WRITE_TOKEN; // use the in-memory store
});

describe("the unit prompt", () => {
  it("is a new prompt: the model gets the topics fixed by id and writes why, links and checkpoints", () => {
    expect(hash(UNIT_SYSTEM_PROMPT)).toBe("a6ae3776b34f3f06");
    expect(unitSystemPrompt()).toBe(UNIT_SYSTEM_PROMPT);
    expect(UNIT_SYSTEM_PROMPT).toContain("with its id copied exactly as given");
    expect(unitSystemPrompt("Grade 9 students")).toContain("AUDIENCE\nThese learners are: Grade 9 students.");
  });

  it("puts the unit, its outcomes and each topic's syllabus fields inside unit tags, stripping look-alikes", () => {
    const prompt = buildUnitPrompt({
      courseTitle: "Intro <unit>psych</unit>",
      unitNumber: 2,
      unitCount: 8,
      unitTitle: "Biological bases",
      outcomes: ["Explain how neurons communicate"],
      topics: [{ ...topic("neurons"), buildsOn: [] }, { ...topic("synapses"), buildsOn: ["neurons"] }],
    });
    expect(prompt).toContain("<unit>\nCourse: Intro psych\nUnit 2 of 8: Biological bases\nUnit outcomes:\n- Explain how neurons communicate\nTopics:\n1. id: neurons");
    expect(prompt).toContain("   Key terms: neurons-a; neurons-b; neurons-c");
    expect(prompt).toContain("   Builds on: neurons");
    expect(prompt.match(/<\/?unit>/g)).toEqual(["<unit>", "</unit>"]);
    expect(buildUnitPrompt({ ...baseInput(), missing: ["hormones"] })).toContain("no usable node for these topic ids: hormones.");
  });
});

function baseInput() {
  return { courseTitle: "C", unitNumber: 1, unitCount: 1, unitTitle: "U", outcomes: [], topics: [{ ...topic("a"), buildsOn: [] }] };
}

describe("validateUnitNodes", () => {
  const topics = makeSyllabus().units[1].topics;

  it("keeps only known topics, in syllabus order, with ids and syllabus fields from code", () => {
    const nodes = validateUnitNodes(
      unitReply(["synapses", "neurons", "made-up-topic", "Brain areas", "hormones"]).nodes.map((node) =>
        node.id === "Brain areas" ? { ...node, id: "Title of brain-areas" } : node,
      ),
      "u2",
      topics,
    );
    expect(nodes.map((node) => node.id)).toEqual(["neurons", "synapses", "brain-areas", "hormones"]);
    const synapses = nodes[1];
    expect(synapses).toMatchObject({
      title: "Title of synapses",
      unitId: "u2",
      topicId: "synapses",
      objectives: topics[1].objectives,
      keyTerms: topics[1].keyTerms,
      inScope: topics[1].inScope,
      outOfScope: topics[1].outOfScope,
      fromSource: false,
      citation: null,
    });
    // The syllabus's buildsOn inside the unit is a link; one to another course is not.
    expect(synapses.prerequisites).toEqual(["neurons"]);
    expect(nodes[0].prerequisites).toEqual([]);
  });

  it("drops a topic with too few checkpoints, takes the first usable reply, and never reuses a taken id", () => {
    const nodes = validateUnitNodes(
      [
        { id: "neurons", why: "x", prerequisites: [], checkpoints: ["only one"] },
        { id: "neurons", why: "Second try.", prerequisites: [], checkpoints: CHECKPOINTS },
        { id: "synapses", why: "", prerequisites: ["synapses"], checkpoints: CHECKPOINTS },
        { id: "hormones", why: "y", prerequisites: [], checkpoints: CHECKPOINTS },
      ],
      "u2",
      topics,
      ["hormones"],
    );
    expect(nodes.map((node) => node.id)).toEqual(["neurons", "synapses"]);
    expect(nodes[0].why).toBe("Second try.");
    // An empty why falls back to the scope line; a self-link is dropped.
    expect(nodes[1].why).toBe(topics[1].inScope);
  });

  it("caps per kind: a degree unit at 6, legacy maps unchanged", () => {
    expect(NODE_LIMITS.degreeUnit).toEqual({ min: 3, max: 6 });
    expect(NODE_LIMITS.legacy).toEqual({ min: 5, max: 14 });
    const many = Array.from({ length: 8 }, (_, index) => topic(`t${index}`));
    const nodes = validateUnitNodes(unitReply(many.map((t) => t.id)).nodes, "u1", many);
    expect(nodes).toHaveLength(6);
  });
});

const U1 = ["what-is-psych", "history", "methods", "ethics"];
const U2 = ["neurons", "synapses", "brain-areas", "hormones"];
const later = () => Date.now() + 112_000;
const COURSE = { title: "Introduction to Psychology", audience: "", programTitle: "Psychology" };

/** A learner map of catalog course `courseId`, as a course open creates it: no nodes, no syllabus stored. */
async function learnerMap(courseId: string, ownerId = "owner-1"): Promise<SkillMap> {
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    courseId,
    title: "Introduction to Psychology",
    subtitle: "",
    sourceKind: "topic",
    sourceText: "Introduction to Psychology",
    nodes: [],
    createdAt: "2026-11-11T10:00:00.000Z",
  };
  await saveSkillMap(map);
  return (await getSkillMap(map.id))!;
}

describe("ensureUnitNodes (canonical unit nodes)", () => {
  it("builds a unit once on the plan profile and stores it under the course id, with no owner or map id", async () => {
    const courseId = randomUUID();
    vi.mocked(chatJSON).mockResolvedValueOnce(
      unitReply(U1, [{ id: "invented", why: "x", prerequisites: [], checkpoints: CHECKPOINTS }]),
    );

    const result = await ensureUnitNodes({ contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() });

    expect(result.status).toBe("ready");
    const call = vi.mocked(chatJSON).mock.calls[0][0];
    expect(call).toMatchObject({ profile: "plan", maxTokens: 16_000, system: UNIT_SYSTEM_PROMPT });
    expect(call.totalMs).toBeLessThanOrEqual(60_000);
    expect("tier" in call).toBe(false);
    expect(call.prompt).toContain("Program: Psychology");
    const stored = await getDoc<{ contentId: string; nodes: { id: string; unitId?: string }[] }>(`unit-nodes/${courseId}/u1`);
    expect(stored?.nodes.map((node) => node.id)).toEqual(U1);
    expect(stored?.nodes.every((node) => node.unitId === "u1")).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("owner-1");

    vi.mocked(chatJSON).mockClear();
    const again = await ensureUnitNodes({ contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() });
    expect(again.status).toBe("ready");
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("makes one model call when two requests build the same unit at once", async () => {
    const courseId = randomUUID();
    vi.mocked(chatJSON).mockResolvedValue(unitReply(U1));
    const input = { contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() };
    const [a, b] = await Promise.all([ensureUnitNodes(input), ensureUnitNodes(input)]);
    expect(chatJSON).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual(["ready", "running"]);
  });

  it("asks once more for topics the first reply left out, then keeps the floor", async () => {
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(["what-is-psych", "history"])).mockResolvedValueOnce(unitReply(["methods", "ethics"]));
    const result = await ensureUnitNodes({ contentId: randomUUID(), unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() });
    expect(chatJSON).toHaveBeenCalledTimes(2);
    expect(vi.mocked(chatJSON).mock.calls[1][0].prompt).toContain("no usable node for these topic ids: methods, ethics.");
    expect(result.status === "ready" && result.nodes.map((node) => node.id)).toEqual(U1);
  });

  it("fails with a 422 and stores nothing when the repair still leaves too few topics", async () => {
    const courseId = randomUUID();
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(["what-is-psych"])).mockResolvedValueOnce(unitReply(["history"]));
    await expect(
      ensureUnitNodes({ contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await getDoc(`unit-nodes/${courseId}/u1`)).toBeNull();
  });

  it("starts nothing when the deadline cannot fit a unit call, and says when someone else is building", async () => {
    const courseId = randomUUID();
    const soon = { contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: Date.now() + 30_000 };
    expect(await ensureUnitNodes(soon)).toEqual({ status: "no-time" });
    const stop = fakeRunning(`unit-nodes/${courseId}/u1`);
    expect(await ensureUnitNodes(soon)).toEqual({ status: "running" });
    expect(await ensureUnitNodes({ ...soon, deadline: later() })).toEqual({ status: "running" });
    stop();
    expect(chatJSON).not.toHaveBeenCalled();
  });
});

describe("learner maps of a catalog course", () => {
  it("store no syllabus, and get the canonical syllabus attached on read", async () => {
    const courseId = randomUUID();
    const map = await learnerMap(courseId);
    await saveSkillMap(map);

    const stored = await getDoc<SkillMap>(`maps/${map.id}`);
    expect(stored && "syllabus" in stored).toBe(false);
    const read = (await getSkillMap(map.id))!;
    expect(read.syllabus?.rootMapId).toBe(courseId);
    expect(read.syllabus?.units.map((unit) => unit.built)).toEqual([false, false, false]);
    expect(read.syllabus?.planning).toBeUndefined();
    expect(readCatalogSyllabus).toHaveBeenCalledWith(courseId);
  });

  it("show a planning syllabus while it is written, and no syllabus while there is none", async () => {
    const map = await learnerMap(randomUUID());
    const partial = { ...makeSyllabus(), units: makeSyllabus().units.slice(0, 1) };
    vi.mocked(readCatalogSyllabus).mockResolvedValue({ state: "planning", syllabus: partial });
    const planning = (await getSkillMap(map.id))!;
    expect(planning.syllabus?.planning).toBe(true);
    expect(planning.syllabus?.units).toHaveLength(1);
    expect((await syncCourseMap(planning)).build).toEqual({ syllabus: "running", unit1: "idle" });

    vi.mocked(readCatalogSyllabus).mockResolvedValue({ state: "idle" });
    const none = (await getSkillMap(map.id))!;
    expect(none.syllabus).toBeUndefined();
    expect((await syncCourseMap(none)).build).toEqual({ syllabus: "idle", unit1: "idle" });
  });

  it("syncCourseMap appends unit 1 once it exists (zero calls), then builds unit 2 ahead", async () => {
    const courseId = randomUUID();
    const map = await learnerMap(courseId);
    const stop = fakeRunning(`unit-nodes/${courseId}/u1`);
    expect((await syncCourseMap(map)).build).toEqual({ syllabus: "ready", unit1: "running" });
    stop();

    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(U1));
    await ensureUnitNodes({ contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() });
    vi.mocked(chatJSON).mockClear();

    const synced = await syncCourseMap((await getSkillMap(map.id))!);
    expect(chatJSON).not.toHaveBeenCalled();
    expect(synced.build).toEqual({ syllabus: "ready", unit1: "ready" });
    expect(synced.map.nodes.map((node) => node.id)).toEqual(U1);
    expect(synced.map.syllabus?.units.map((unit) => unit.built)).toEqual([true, false, false]);
    expect((await getDoc<SkillMap>(`maps/${map.id}`))?.nodes.map((node) => node.id)).toEqual(U1);

    // Pre-generation rule 3: unit 2's canonical build runs after the response.
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(U2));
    await runAfterTasks();
    expect(chatJSON).toHaveBeenCalledTimes(1);
    expect((await getDoc<{ nodes: unknown[] }>(`unit-nodes/${courseId}/u2`))?.nodes).toHaveLength(4);

    // A second sync changes nothing.
    vi.mocked(chatJSON).mockClear();
    const again = await syncCourseMap((await getSkillMap(map.id))!);
    expect(again.map.nodes).toHaveLength(4);
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("two maps of one course share one unit build and get the same nodes and ids", async () => {
    const courseId = randomUUID();
    const mine = await learnerMap(courseId, "owner-1");
    const theirs = await learnerMap(courseId, "owner-2");
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(U1));
    await ensureUnitNodes({ contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() });
    const a = await syncCourseMap(mine);
    const b = await syncCourseMap(theirs);
    afterTasks.length = 0;
    expect(chatJSON).toHaveBeenCalledTimes(1);
    expect(a.map.nodes).toEqual(b.map.nodes);
    expect(contentIdOf(a.map)).toBe(contentIdOf(b.map));
  });

  it("a copy keeps the courseId, so it shares every piece of content", async () => {
    const courseId = randomUUID();
    const map = await learnerMap(courseId);
    const copy = await copySkillMap(map.id, "friend");
    expect(copy.courseId).toBe(courseId);
    expect(contentIdOf(copy)).toBe(courseId);
    expect("syllabus" in (await getDoc<SkillMap>(`maps/${copy.id}`))!).toBe(false);
  });

  it("a posting map keeps its own id as its content id", () => {
    expect(contentIdOf({ id: "map-1" })).toBe("map-1");
    expect(contentIdOf({ id: "map-1", courseId: "course-1" })).toBe("course-1");
  });
});

describe("generateUnit", () => {
  async function withUnit1(courseId: string, ownerId = "owner-1") {
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(U1));
    await ensureUnitNodes({ contentId: courseId, unitId: "u1", syllabus: makeSyllabus(), course: COURSE, deadline: later() });
    const { map } = await syncCourseMap(await learnerMap(courseId, ownerId));
    afterTasks.length = 0;
    vi.mocked(chatJSON).mockReset();
    return map;
  }

  it("makes no call in the request: it starts the canonical build after the response and says building", async () => {
    const courseId = randomUUID();
    const map = await withUnit1(courseId);
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(U2));

    expect(await generateUnit(map, "u2", "owner-1")).toEqual({ status: "building" });
    expect(chatJSON).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(chatJSON).toHaveBeenCalledTimes(1);

    const result = await generateUnit((await getSkillMap(map.id))!, "u2", "owner-1");
    expect(result.status).toBe("ready");
    const saved = (await getSkillMap(map.id))!;
    // Unit 1's node ids never move, so proofs and lessons keyed to them still match.
    expect(saved.nodes.map((node) => node.id)).toEqual([...U1, ...U2]);
    expect(saved.syllabus?.units.map((unit) => unit.built)).toEqual([true, true, false]);
    expect(isUnitBuilt(saved, "u2")).toBe(true);
  });

  it("gives a second learner the unit with zero model calls", async () => {
    const courseId = randomUUID();
    const first = await withUnit1(courseId, "owner-1");
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(U2));
    await generateUnit(first, "u2", "owner-1");
    await runAfterTasks();

    const second = await withUnit1(courseId, "owner-2");
    vi.mocked(chatJSON).mockClear();
    const result = await generateUnit(second, "u2", "owner-2");
    expect(result.status).toBe("ready");
    expect(chatJSON).not.toHaveBeenCalled();
    expect((await getSkillMap(second.id))!.nodes.map((node) => node.id)).toEqual([...U1, ...U2]);
  });

  it("says building while someone else builds the unit, and returns a built unit at once", async () => {
    const courseId = randomUUID();
    const map = await withUnit1(courseId);
    const stop = fakeRunning(`unit-nodes/${courseId}/u2`);
    expect(await generateUnit(map, "u2", "owner-1")).toEqual({ status: "building" });
    stop();
    expect(afterTasks).toHaveLength(0);
    expect(await generateUnit(map, "u1", "owner-1")).toEqual({ status: "ready", map });
  });

  it("says building while another request appends to the map, and takes over a dead append claim", async () => {
    const courseId = randomUUID();
    const map = await withUnit1(courseId);
    vi.mocked(chatJSON).mockResolvedValueOnce(unitReply(U2));
    await ensureUnitNodes({ contentId: courseId, unitId: "u2", syllabus: makeSyllabus(), course: COURSE, deadline: later() });

    await putDoc(`unit-claims/${map.id}`, { unitId: "u2", claimedAt: new Date().toISOString() });
    expect(await generateUnit(map, "u2", "owner-1")).toEqual({ status: "building" });
    await putDoc(`unit-claims/${map.id}`, { unitId: "u2", claimedAt: new Date(Date.now() - STALE_UNIT_CLAIM_MS - 1000).toISOString() });
    expect((await generateUnit(map, "u2", "owner-1")).status).toBe("ready");
    expect(await getDoc(`unit-claims/${map.id}`)).toBeNull();
  });

  it("refuses anyone but the owner, and a unit the syllabus does not have, with a 404", async () => {
    const map = await withUnit1(randomUUID());
    await expect(generateUnit(map, "u2", "someone-else")).rejects.toMatchObject({ status: 404 });
    await expect(generateUnit(map, "u9", "owner-1")).rejects.toMatchObject({ status: 404 });
    const legacy: SkillMap = { ...map, id: randomUUID(), courseId: undefined, syllabus: undefined };
    await saveSkillMap(legacy);
    await expect(generateUnit(legacy, "u1", "owner-1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("toPublicMap", () => {
  it("adds the syllabus without rootMapId and the build state, and leaves older maps exactly as before", async () => {
    const map = (await getSkillMap((await learnerMap(randomUUID())).id))!;
    const view = toPublicMap(map, { syllabus: "ready", unit1: "running" });
    expect(view.syllabus?.units).toHaveLength(3);
    expect(view.syllabus && "rootMapId" in view.syllabus).toBe(false);
    expect(view.build).toEqual({ syllabus: "ready", unit1: "running" });
    expect("syllabus" in toPublicMap({ ...map, syllabus: undefined })).toBe(false);
    expect("build" in toPublicMap(map)).toBe(false);
  });
});
