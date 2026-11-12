import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import type { CourseSyllabus, SkillMap, SkillNode } from "@/shared/types";
import {
  answerFollowUp,
  deleteLearnerData,
  getFinalInterview,
  getPassedFinal,
  getPassedUnitTests,
  getUnitTests,
  startFinalInterview,
} from "./attempts";
import { FINAL_NODE_ID, finalKey, finalPlan, questionsSystem, QUESTIONS_SYSTEM } from "./final";

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

function modelAsks(count: number) {
  mockChatJSON.mockResolvedValueOnce({
    questions: Array.from({ length: count }, (_, i) => ({ question: `Question ${i + 1}?`, topics: [1, 2] })),
  });
}

/** Answers every question in a started test, passing the first `passes` of them. */
async function answerAll(attemptIds: string[], passes: number) {
  for (const [index, attemptId] of attemptIds.entries()) {
    mockChatJSON.mockResolvedValueOnce({ passed: index < passes, feedback: index < passes ? "Right." : "Not passed." });
    await answerFollowUp(OWNER, attemptId, "An answer about the topics.");
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
    expect(ready).toMatchObject({ state: "ready", unitId: "u1", questionCount: 4, passMark: 3 });
    // Another unit is still shut: its topic is not proved.
    expect((await getFinalInterview(OWNER, mapId, "u2")).state).toBe("locked");
  });

  it("asks 4 questions about that unit's topics only, stored as a final with node id final:<unit>", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    modelAsks(4);
    const started = await startFinalInterview(OWNER, mapId, "u1");

    expect(started).toMatchObject({ state: "in-progress", unitId: "u1", questionCount: 4, passMark: 3 });
    expect(started.questions).toHaveLength(4);
    expect(started.questions[0].topics).toEqual(["Topic a1", "Topic a2"]);

    const call = mockChatJSON.mock.calls[0][0];
    expect(call.system).toContain("Write 4 questions for a short unit test on that unit only");
    expect(call.prompt).toContain("Unit: Unit u1");
    expect(call.prompt).toContain("Topic a1");
    expect(call.prompt).not.toContain("Topic b1");
    // Syllabus nodes carry their lines into the final's topic list.
    expect(call.prompt).toContain("Objectives: explain it");

    const record = await getDoc<{ unitId: string; passMark: number; attemptIds: string[] }>(`final/${mapId}/u1`);
    expect(record).toMatchObject({ unitId: "u1", passMark: 3 });
    const attempt = await getDoc<{ nodeId: string; format: string }>(`attempts/${record!.attemptIds[0]}`);
    expect(attempt).toMatchObject({ nodeId: "final:u1", format: "final" });
    // The course final's own record is untouched.
    expect(await getDoc(finalKey(mapId))).toBeNull();

    // Asking again while it is under way gives the same questions at no cost.
    expect((await startFinalInterview(OWNER, mapId, "u1")).questions).toEqual(started.questions);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });

  it("3 of 4 passes it, 2 of 4 does not, and a retry writes fresh questions", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    modelAsks(4);
    const first = await startFinalInterview(OWNER, mapId, "u1");
    await answerAll(first.questions.map((q) => q.attemptId), 2);
    const failed = await getFinalInterview(OWNER, mapId, "u1");
    expect(failed.state).toBe("failed");
    expect(failed.result).toMatchObject({ passed: false, passedCount: 2 });
    expect(await getPassedUnitTests(mapId)).toEqual({});

    modelAsks(4);
    const retry = await startFinalInterview(OWNER, mapId, "u1");
    expect(retry.state).toBe("in-progress");
    expect(retry.questions[0].attemptId).not.toBe(first.questions[0].attemptId);
    await answerAll(retry.questions.map((q) => q.attemptId), 3);
    const passed = await getFinalInterview(OWNER, mapId, "u1");
    expect(passed.state).toBe("passed");
    expect(passed.result).toMatchObject({ passed: true, passedCount: 3 });
    expect(Object.keys(await getPassedUnitTests(mapId))).toEqual(["u1"]);
    // A unit test never counts as the course final.
    expect(await getPassedFinal(mapId)).toBeNull();
  });

  it("grades an answer against that unit's facts only", async () => {
    await saveMap("degree", ["u1", "u2"], UNIT_NODES);
    await prove("a1", "a2");
    modelAsks(4);
    const started = await startFinalInterview(OWNER, mapId, "u1");
    await answerAll([started.questions[0].attemptId], 1);
    const grading = mockChatJSON.mock.calls[1][0];
    expect(grading.prompt).toContain("Topic a1");
    expect(grading.prompt).not.toContain("Topic b1");
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
});

describe("the degree course final", () => {
  const ALL = [node("a1", "u1"), node("b1", "u2"), node("c1", "u3")];

  it("is 6 questions with pass mark 4; a map with no syllabus stays at 3 with pass mark 2", () => {
    const degree = finalPlan({ ...({} as SkillMap), nodes: [], syllabus: syllabus([]) });
    expect(degree).toMatchObject({ kind: "course", nodeId: FINAL_NODE_ID, questions: 6, passMark: 4 });
    const plain = finalPlan({ ...({} as SkillMap), nodes: [] });
    expect(plain).toMatchObject({ questions: 3, passMark: 2 });
    expect(questionsSystem(plain)).toBe(QUESTIONS_SYSTEM);
    expect(questionsSystem(degree)).toContain("Write 6 questions for the final interview");
    expect(questionsSystem(degree)).toContain("Spread them across the whole course");
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

    for (const unitId of ["u1", "u2"]) {
      await putDoc(finalKey(mapId, unitId), {
        mapId,
        ownerId: OWNER,
        unitId,
        passMark: 3,
        attemptIds: [],
        topics: [],
        startedAt: "x",
        result: { passed: true, passedCount: 4, finishedAt: "x" },
      });
    }
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("locked");
  });

  it("then asks 6 questions, and 4 of 6 passes it while 3 does not", async () => {
    await saveMap("degree", ["u1", "u2", "u3"], ALL);
    await prove("a1", "b1", "c1");
    for (const unitId of ["u1", "u2", "u3"]) {
      await putDoc(finalKey(mapId, unitId), {
        mapId,
        ownerId: OWNER,
        unitId,
        passMark: 3,
        attemptIds: [],
        topics: [],
        startedAt: "x",
        result: { passed: true, passedCount: 4, finishedAt: "x" },
      });
    }
    expect(await getFinalInterview(OWNER, mapId)).toMatchObject({ state: "ready", questionCount: 6, passMark: 4 });

    mockChatJSON.mockResolvedValueOnce({
      questions: Array.from({ length: 6 }, (_, i) => ({ question: `Question ${i + 1}?`, topics: [i % 3 === 0 ? 1 : 2, 3] })),
    });
    const started = await startFinalInterview(OWNER, mapId);
    expect(started.questions).toHaveLength(6);
    expect(started.unitId).toBeUndefined();
    // Forty topics would make a huge prompt, so the long final leaves the syllabus lines out.
    expect(mockChatJSON.mock.calls[0][0].prompt).not.toContain("Objectives:");

    await answerAll(started.questions.map((q) => q.attemptId), 3);
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("failed");

    mockChatJSON.mockResolvedValueOnce({ questions: Array.from({ length: 6 }, (_, i) => ({ question: `Again ${i}?`, topics: [1] })) });
    const retry = await startFinalInterview(OWNER, mapId);
    await answerAll(retry.questions.map((q) => q.attemptId), 4);
    expect(await getFinalInterview(OWNER, mapId)).toMatchObject({ state: "passed", result: { passed: true, passedCount: 4 } });
    expect(await getPassedFinal(mapId)).toMatchObject({ passedCount: 4 });
    // The grader of a long final sees only the question's own topics.
    const lastGrade = mockChatJSON.mock.calls.at(-1)![0];
    expect(lastGrade.prompt).toContain("Topic a1");
    expect(lastGrade.prompt).not.toContain("Topic b1");
  });

  it("a map with no syllabus keeps the old rule: every topic proved", async () => {
    await saveMap("plain", ["u1"], [node("a1", "u1"), node("a2", "u1")]);
    await prove("a1");
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("locked");
    await prove("a2");
    expect(await getFinalInterview(OWNER, mapId)).toMatchObject({ state: "ready", questionCount: 3, passMark: 2 });
    modelAsks(3);
    expect((await startFinalInterview(OWNER, mapId)).questions).toHaveLength(3);
  });
});

describe("Delete my data", () => {
  it("removes unit test records and their attempts", async () => {
    await saveMap("degree", ["u1"], [node("a1", "u1"), node("a2", "u1")]);
    await prove("a1", "a2");
    modelAsks(4);
    await startFinalInterview(OWNER, mapId, "u1");
    expect(await listKeys(`final/${mapId}/`)).toHaveLength(1);

    await deleteLearnerData(OWNER);
    expect(await listKeys(`final/${mapId}/`)).toHaveLength(0);
  });
});
