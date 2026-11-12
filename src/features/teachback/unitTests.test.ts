import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import type { CourseSyllabus, SkillMap, SkillNode } from "@/shared/types";
import {
  deleteLearnerData,
  getFinalInterview,
  getPassedFinal,
  getPassedUnitTests,
  getUnitTests,
  startFinalInterview,
  submitFinalTest,
} from "./attempts";
import { FINAL_NODE_ID, finalKey, finalPlan, testSystem, type McFinalRecord } from "./final";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/features/skill-map", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/skill-map")>()),
  skillBlock: vi.fn(() => ["Objectives: explain it"]),
}));
const mockChatJSON = vi.mocked(chatJSON);

const OWNER = "owner-user";
let mapId: string;

function node(id: string, unitId: string | undefined): SkillNode {
  return {
    id,
    title: `Topic ${id}`,
    why: "",
    prerequisites: [],
    fromSource: false,
    citation: null,
    checkpoints: ["One fact", "Another fact", "A third fact"],
    ...(unitId && { unitId, topicId: id, objectives: ["Explain it"] }),
  };
}

function syllabus(builtUnits: string[]): CourseSyllabus {
  const units = ["u1", "u2", "u3"].map((id) => ({
    id,
    title: `Unit ${id}`,
    outcomeIds: ["o1"],
    built: builtUnits.includes(id),
    topics: [],
  }));
  return {
    version: 1,
    courseSlug: "intro",
    outcomes: [{ id: "o1", text: "Outcome" }],
    units,
    // What syllabi written before Nov 12 store. The test's own count comes from SYLLABUS_SHAPE.
    assessment: { unitTests: true, finalQuestions: 6 },
  };
}

/** "degree": a syllabus course (every topic course); "plain": a posting or PDF map, with no syllabus. */
async function saveMap(kind: "plain" | "degree", builtUnits: string[], nodes: SkillNode[]) {
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Introduction to Psychology",
    subtitle: "",
    sourceKind: "topic",
    sourceText: "",
    nodes,
    createdAt: new Date().toISOString(),
    ...(kind === "degree" && { syllabus: syllabus(builtUnits) }),
  };
  await putDoc(`maps/${mapId}`, map);
  return map;
}

async function prove(...nodeIds: string[]) {
  for (const nodeId of nodeIds) {
    await putDoc(`progress/${mapId}/${OWNER}/${nodeId}`, { nodeId, attemptId: "x", provenAt: new Date().toISOString() });
  }
}

function modelWrites(count: number, prefix = "Question", topics = [1, 2]) {
  mockChatJSON.mockResolvedValueOnce({
    questions: Array.from({ length: count }, (_, i) => ({
      question: `${prefix} ${i + 1}: what follows from these topics?`,
      options: [`Right ${i + 1}`, `Wrong a ${i + 1}`, `Wrong b ${i + 1}`, `Wrong c ${i + 1}`],
      explanation: `Why ${i + 1}.`,
      topics,
    })),
  });
}

/** Submits the started test, getting the first `right` questions right. */
async function submitGetting(right: number, unitId?: string) {
  const record = (await getDoc<McFinalRecord>(finalKey(mapId, unitId)))!;
  const answers = record.questions.map((question, index) => (index < right ? question.correctIndex : (question.correctIndex + 1) % 4));
  return submitFinalTest(OWNER, mapId, unitId, { testId: record.testId, answers });
}

async function passUnitTests(...unitIds: string[]) {
  for (const unitId of unitIds) {
    await putDoc(finalKey(mapId, unitId), {
      mapId,
      ownerId: OWNER,
      unitId,
      format: "multiple-choice",
      testId: randomUUID(),
      passMark: 5,
      questions: [],
      startedAt: "x",
      result: { passed: true, passedCount: 6, finishedAt: "x", format: "multiple-choice", questionCount: 6 },
    });
  }
}

const UNIT_NODES = [node("a1", "u1"), node("a2", "u1"), node("b1", "u2")];

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();
  mapId = randomUUID();
});

describe("a unit test", () => {
  it("opens when every topic of the unit is proved, not before", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    expect((await getFinalInterview(OWNER, mapId, "u1")).state).toBe("locked");

    await prove("a1");
    expect((await getFinalInterview(OWNER, mapId, "u1")).state).toBe("locked");
    await expect(startFinalInterview(OWNER, mapId, "u1")).rejects.toMatchObject({ status: 403 });
    expect(mockChatJSON).not.toHaveBeenCalled();

    await prove("a2");
    const ready = await getFinalInterview(OWNER, mapId, "u1");
    expect(ready).toMatchObject({ state: "ready", unitId: "u1", questionCount: 6, passMark: 5, format: "multiple-choice" });
    // Another unit is still shut: its topic is not proved.
    expect((await getFinalInterview(OWNER, mapId, "u2")).state).toBe("locked");
  });

  it("asks 6 multiple-choice questions about that unit's topics only, stored at final/<map>/<unit>", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    modelWrites(6);
    const started = await startFinalInterview(OWNER, mapId, "u1");

    expect(started).toMatchObject({ state: "in-progress", unitId: "u1", questionCount: 6, passMark: 5 });
    expect(started.questions).toHaveLength(6);
    expect(started.questions[0].topics).toEqual(["Topic a1", "Topic a2"]);
    expect(JSON.stringify(started)).not.toContain("correctIndex");

    const call = mockChatJSON.mock.calls[0][0];
    expect(call.profile).toBe("write");
    expect(call.system).toContain("multiple-choice unit test of exactly 6 questions on that unit only");
    expect(call.prompt).toContain("Unit: Unit u1");
    expect(call.prompt).toContain("Topic a1");
    expect(call.prompt).not.toContain("Topic b1");
    // Syllabus nodes carry their lines into the test's topic list.
    expect(call.prompt).toContain("Objectives: explain it");

    const record = await getDoc<McFinalRecord>(`final/${mapId}/u1`);
    expect(record).toMatchObject({ unitId: "u1", passMark: 5, format: "multiple-choice" });
    // No per-question attempts any more.
    expect(await listKeys("attempts/")).toEqual([]);
    // The course final's own record is untouched.
    expect(await getDoc(finalKey(mapId))).toBeNull();

    // Asking again while it is under way gives the same questions at no cost.
    expect((await startFinalInterview(OWNER, mapId, "u1")).questions).toEqual(started.questions);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });

  it("5 of 6 passes it, 4 of 6 does not, and a retake writes new questions", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    modelWrites(6);
    const first = await startFinalInterview(OWNER, mapId, "u1");
    const failed = await submitGetting(4, "u1");
    expect(failed).toMatchObject({ state: "failed", result: { passed: false, passedCount: 4, questionCount: 6 } });
    expect(await getPassedUnitTests(mapId)).toEqual({});

    modelWrites(6, "Retake");
    const retake = await startFinalInterview(OWNER, mapId, "u1");
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(retake.state).toBe("in-progress");
    expect(retake.testId).not.toBe(first.testId);
    expect(retake.questions[0].question).toMatch(/^Retake/);

    const passed = await submitGetting(5, "u1");
    expect(passed).toMatchObject({ state: "passed", result: { passed: true, passedCount: 5 } });
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(Object.keys(await getPassedUnitTests(mapId))).toEqual(["u1"]);
    // A unit test never counts as the course final.
    expect(await getPassedFinal(mapId)).toBeNull();
  });

  it("tells a retake the failed questions and drops any repeat of them", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    modelWrites(6);
    const first = await startFinalInterview(OWNER, mapId, "u1");
    await submitGetting(0, "u1");

    // The model repeats one old question among seven: code drops it and keeps six new ones.
    mockChatJSON.mockResolvedValueOnce({
      questions: [
        { question: first.questions[0].question, options: ["R", "W1", "W2", "W3"], explanation: "Why.", topics: [1] },
        ...Array.from({ length: 6 }, (_, i) => ({
          question: `Fresh ${i + 1}: what follows?`,
          options: [`Right ${i}`, `Wrong a ${i}`, `Wrong b ${i}`, `Wrong c ${i}`],
          explanation: "Why.",
          topics: [1],
        })),
      ],
    });
    const retake = await startFinalInterview(OWNER, mapId, "u1");
    const prompt = mockChatJSON.mock.calls[1][0].prompt;
    for (const question of first.questions) expect(prompt).toContain(question.question);
    expect(retake.questions.map((question) => question.question)).toEqual(Array.from({ length: 6 }, (_, i) => `Fresh ${i + 1}: what follows?`));
    // Kept on the server for the next retake, never sent.
    expect(JSON.stringify(retake)).not.toContain("previousQuestions");
    expect((await getDoc<McFinalRecord>(finalKey(mapId, "u1")))!.previousQuestions).toEqual(first.questions.map((question) => question.question));
  });

  it("lists every built unit's test, and a quick course has none", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    const tests = await getUnitTests(OWNER, mapId);
    expect(tests.map((t) => [t.unitId, t.test.state])).toEqual([
      ["u1", "ready"],
      ["u2", "locked"],
    ]);
    // u3 is not built, so it has no test to show yet.
    expect(tests.map((t) => t.title)).toEqual(["Unit u1", "Unit u2"]);

    await saveMap("plain", ["u1"], [node("a1", "u1")]);
    expect(await getUnitTests(OWNER, mapId)).toEqual([]);
    await expect(getFinalInterview(OWNER, mapId, "u1")).rejects.toMatchObject({ status: 404 });
  });

  it("a unit the syllabus does not have is a 404", async () => {
    await saveMap("degree", ["u1"], UNIT_NODES);
    await expect(getFinalInterview(OWNER, mapId, "u9")).rejects.toMatchObject({ status: 404 });
    await expect(startFinalInterview(OWNER, mapId, "u9")).rejects.toMatchObject({ status: 404 });
  });

  it("an old written unit test that was passed still counts and shows as written", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    await putDoc(finalKey(mapId, "u1"), {
      mapId,
      ownerId: OWNER,
      unitId: "u1",
      passMark: 3,
      attemptIds: ["x1", "x2", "x3", "x4"],
      topics: [[], [], [], []],
      startedAt: "x",
      result: { passed: true, passedCount: 3, finishedAt: "2026-11-10T00:00:00.000Z" },
    });
    expect(await getFinalInterview(OWNER, mapId, "u1")).toMatchObject({ state: "passed", format: "written", questionCount: 4, passMark: 3 });
    expect((await getPassedUnitTests(mapId)).u1).toMatchObject({ passedCount: 3, questionCount: 4 });
  });
});

describe("the degree course final", () => {
  const ALL = [node("a1", "u1"), node("b1", "u2"), node("c1", "u3")];

  it("is 10 questions with pass mark 8; a map with no syllabus is 5 with pass mark 4", () => {
    const degree = finalPlan({ ...({} as SkillMap), nodes: [], syllabus: syllabus([]) });
    expect(degree).toMatchObject({ kind: "course", nodeId: FINAL_NODE_ID, questions: 10, passMark: 8 });
    const plain = finalPlan({ ...({} as SkillMap), nodes: [] });
    expect(plain).toMatchObject({ questions: 5, passMark: 4 });
    expect(finalPlan({ ...({} as SkillMap), nodes: [], syllabus: syllabus([]) }, "u1")).toMatchObject({ questions: 6, passMark: 5 });
    expect(testSystem(degree, true)).toContain("multiple-choice final test of exactly 10 questions");
    expect(testSystem(degree, true)).toContain("every unit gets at least one question");
  });

  it("stays shut while a unit is unbuilt, even with every built topic proved", async () => {
    await saveMap("degree", ["u1", "u2"], ALL.slice(0, 2));
    await prove("a1", "b1");
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("locked");
  });

  it("stays shut until every unit test is passed", async () => {
    await saveMap("degree", ["u1", "u2", "u3"], ALL);
    await prove("a1", "b1", "c1");
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("locked");
    await expect(startFinalInterview(OWNER, mapId)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/pass each unit test/) });

    await passUnitTests("u1", "u2");
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("locked");
  });

  it("then asks 10 questions spread over the units, and 8 of 10 passes it while 7 does not", async () => {
    await saveMap("degree", ["u1", "u2", "u3"], ALL);
    await prove("a1", "b1", "c1");
    await passUnitTests("u1", "u2", "u3");
    expect(await getFinalInterview(OWNER, mapId)).toMatchObject({ state: "ready", questionCount: 10, passMark: 8 });

    modelWrites(10, "Final", [1, 3]);
    const started = await startFinalInterview(OWNER, mapId);
    expect(started.questions).toHaveLength(10);
    expect(started.unitId).toBeUndefined();
    const prompt = String(mockChatJSON.mock.calls[0][0].prompt);
    // Topics grouped under their units; forty topics would make a huge prompt, so no syllabus lines.
    expect(prompt).toContain("Unit 1: Unit u1\n1. Topic a1");
    expect(prompt).toContain("Unit 3: Unit u3\n3. Topic c1");
    expect(prompt).not.toContain("Objectives:");
    expect(started.questions[0].topics).toEqual(["Topic a1", "Topic c1"]);

    expect(await submitGetting(7)).toMatchObject({ state: "failed", result: { passedCount: 7 } });
    expect(await getPassedFinal(mapId)).toBeNull();

    modelWrites(10, "Again");
    await startFinalInterview(OWNER, mapId);
    expect(await submitGetting(8)).toMatchObject({ state: "passed", result: { passed: true, passedCount: 8, questionCount: 10 } });
    expect(await getPassedFinal(mapId)).toMatchObject({ passedCount: 8, format: "multiple-choice" });
  });

  it("a map with no syllabus keeps the old rule: every topic proved", async () => {
    await saveMap("plain", ["u1"], [node("a1", "u1"), node("a2", "u1")]);
    await prove("a1");
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("locked");
    await prove("a2");
    expect(await getFinalInterview(OWNER, mapId)).toMatchObject({ state: "ready", questionCount: 5, passMark: 4 });
    modelWrites(5);
    expect((await startFinalInterview(OWNER, mapId)).questions).toHaveLength(5);
  });
});

describe("Delete my data", () => {
  it("removes unit test records", async () => {
    await saveMap("degree", ["u1"], [node("a1", "u1"), node("a2", "u1")]);
    await prove("a1", "a2");
    modelWrites(6);
    await startFinalInterview(OWNER, mapId, "u1");
    expect(await listKeys(`final/${mapId}/`)).toHaveLength(1);

    await deleteLearnerData(OWNER);
    expect(await listKeys(`final/${mapId}/`)).toHaveLength(0);
  });
});
