import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import type { Attempt, SkillMap } from "@/shared/types";
import {
  activityTimes,
  answerFollowUp,
  deleteLearnerData,
  getFinalInterview,
  getPassedFinal,
  startFinalInterview,
  submitFinalTest,
} from "./attempts";
import { finalKey, type FinalView, type McFinalRecord } from "./final";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

const OWNER = "owner-user";
const STRANGER = "someone-else";
let mapId: string;

/** A reply the model might give: `count` usable questions, the correct option first. */
function modelWrites(count: number, prefix = "Question") {
  mockChatJSON.mockResolvedValueOnce({
    questions: Array.from({ length: count }, (_, i) => ({
      question: `${prefix} ${i + 1}: what happens when both topics meet?`,
      options: [`Right answer ${i + 1}`, `Tempting mistake ${i + 1}`, `Common slip ${i + 1}`, `Unrelated idea ${i + 1}`],
      explanation: `Explanation ${prefix} ${i + 1}: the right answer follows from the key fact.`,
      topics: [1, 2],
    })),
  });
}

async function storedTest(unitId?: string): Promise<McFinalRecord> {
  return (await getDoc<McFinalRecord>(finalKey(mapId, unitId)))!;
}

/** Choices that get the first `right` questions right and the rest wrong. */
async function answersGetting(right: number, unitId?: string): Promise<number[]> {
  const record = await storedTest(unitId);
  return record.questions.map((question, index) => (index < right ? question.correctIndex : (question.correctIndex + 1) % 4));
}

async function proveEverything() {
  for (const nodeId of ["a", "b"]) {
    await putDoc(`progress/${mapId}/${OWNER}/${nodeId}`, { nodeId, attemptId: "x", provenAt: new Date().toISOString() });
  }
}

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();
  mapId = randomUUID();
  const node = (id: string, prerequisites: string[]) => ({
    id,
    title: `Topic ${id}`,
    why: "",
    prerequisites,
    fromSource: false,
    citation: null,
    checkpoints: ["One fact", "Another fact", "A third fact"],
  });
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Course",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    nodes: [node("a", []), node("b", ["a"])],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

describe("the final test of a posting or PDF map", () => {
  it("stays locked until every topic is proven", async () => {
    expect(await getFinalInterview(OWNER, mapId)).toMatchObject({ state: "locked", questionCount: 5, passMark: 4, format: "multiple-choice" });
    await expect(startFinalInterview(OWNER, mapId)).rejects.toMatchObject({ status: 403 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("is 5 multiple-choice questions from one write call, with no key or explanation before submitting", async () => {
    await proveEverything();
    modelWrites(5);
    const started = await startFinalInterview(OWNER, mapId);

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ profile: "write" });
    expect(started).toMatchObject({ state: "in-progress", questionCount: 5, passMark: 4, format: "multiple-choice" });
    expect(started.questions).toHaveLength(5);
    expect(started.questions[0].options).toHaveLength(4);
    expect(started.questions[0].topics).toEqual(["Topic a", "Topic b"]);
    expectNoKey(started);
    expectNoKey(await getFinalInterview(OWNER, mapId));

    // The order is fixed when the set is written: a reload and a second start show the same, at no cost.
    expect((await getFinalInterview(OWNER, mapId)).questions).toEqual(started.questions);
    expect((await startFinalInterview(OWNER, mapId)).questions).toEqual(started.questions);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);

    // Code shuffled the options: the stored key matches what the model wrote first.
    const record = await storedTest();
    for (const [index, question] of record.questions.entries()) {
      expect(question.options[question.correctIndex]).toBe(`Right answer ${index + 1}`);
    }
  });

  it("is graded in code: 4 of 5 passes, with the review in the reply, and a second submit is refused", async () => {
    await proveEverything();
    modelWrites(5);
    const started = await startFinalInterview(OWNER, mapId);
    const answers = await answersGetting(4);

    const graded = await submitFinalTest(OWNER, mapId, undefined, { testId: started.testId!, answers });
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(graded).toMatchObject({ state: "passed", result: { passed: true, passedCount: 4, questionCount: 5, format: "multiple-choice" } });
    expect(graded.review).toHaveLength(5);
    expect(graded.review![0]).toMatchObject({ chosen: answers[0], explanation: expect.stringContaining("Explanation Question 1") });
    expect(graded.review![0].options[graded.review![0].correctIndex]).toBe("Right answer 1");
    expect(graded.review![4].chosen).not.toBe(graded.review![4].correctIndex);

    // Later reads keep the review; the course badge is recorded.
    expect((await getFinalInterview(OWNER, mapId)).review).toEqual(graded.review);
    expect(await getPassedFinal(mapId)).toMatchObject({ passedCount: 4, questionCount: 5, format: "multiple-choice" });

    await expect(submitFinalTest(OWNER, mapId, undefined, { testId: started.testId!, answers })).rejects.toMatchObject({ status: 409 });
    // Passed: asking to start again changes nothing.
    expect((await startFinalInterview(OWNER, mapId)).testId).toBe(started.testId);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });

  it("3 of 5 fails, and a retake writes new questions with a new model call", async () => {
    await proveEverything();
    modelWrites(5);
    const first = await startFinalInterview(OWNER, mapId);
    const failed = await submitFinalTest(OWNER, mapId, undefined, { testId: first.testId!, answers: await answersGetting(3) });
    expect(failed).toMatchObject({ state: "failed", result: { passed: false, passedCount: 3 } });
    expect(await getPassedFinal(mapId)).toBeNull();

    modelWrites(5, "Retake");
    const retake = await startFinalInterview(OWNER, mapId);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(retake.state).toBe("in-progress");
    expect(retake.testId).not.toBe(first.testId);
    expect(retake.questions[0].question).toMatch(/^Retake 1/);
    expect(retake.review).toBeUndefined();
    expectNoKey(retake);

    // The replaced set can no longer be submitted.
    await expect(submitFinalTest(OWNER, mapId, undefined, { testId: first.testId!, answers: [0, 0, 0, 0, 0] })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses an incomplete submission without using it up", async () => {
    await proveEverything();
    modelWrites(5);
    const started = await startFinalInterview(OWNER, mapId);
    const testId = started.testId!;
    await expect(submitFinalTest(OWNER, mapId, undefined, { testId, answers: [0, 1] })).rejects.toMatchObject({ status: 400 });
    await expect(submitFinalTest(OWNER, mapId, undefined, { testId, answers: [0, 1, 2, 3, 4] })).rejects.toMatchObject({ status: 400 });
    await expect(submitFinalTest(OWNER, mapId, undefined, { testId, answers: [0, 1, 2, 3, 1.5] })).rejects.toMatchObject({ status: 400 });
    expect((await submitFinalTest(OWNER, mapId, undefined, { testId, answers: await answersGetting(5) })).state).toBe("passed");
  });

  it("accepts only one of two submissions sent at the same moment", async () => {
    await proveEverything();
    modelWrites(5);
    const started = await startFinalInterview(OWNER, mapId);
    const answers = await answersGetting(5);
    const results = await Promise.allSettled([1, 2, 3].map(() => submitFinalTest(OWNER, mapId, undefined, { testId: started.testId!, answers })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("gives a stranger the same 404 as a missing map", async () => {
    await proveEverything();
    await expect(getFinalInterview(STRANGER, mapId)).rejects.toMatchObject({ status: 404 });
    await expect(startFinalInterview(STRANGER, mapId)).rejects.toMatchObject({ status: 404 });
    modelWrites(5);
    const started = await startFinalInterview(OWNER, mapId);
    await expect(
      submitFinalTest(STRANGER, mapId, undefined, { testId: started.testId!, answers: await answersGetting(5) }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(getFinalInterview(OWNER, randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when the model's questions break the rules", async () => {
    await proveEverything();
    mockChatJSON.mockResolvedValueOnce({
      questions: Array.from({ length: 5 }, (_, i) => ({
        question: `Question ${i}?`,
        options: i === 0 ? ["Only", "three", "options"] : ["Right", "All of the above", "Wrong", "Other"],
        explanation: "Because.",
        topics: [1],
      })),
    });
    await expect(startFinalInterview(OWNER, mapId)).rejects.toMatchObject({ status: 502 });
    expect(await getDoc(finalKey(mapId))).toBeNull();
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("ready");
  });

  it("counts when the test was started and submitted as study activity, and Delete my data removes it", async () => {
    await proveEverything();
    modelWrites(5);
    const started = await startFinalInterview(OWNER, mapId);
    await submitFinalTest(OWNER, mapId, undefined, { testId: started.testId!, answers: await answersGetting(5) });
    const record = await storedTest();
    expect(await activityTimes(mapId, OWNER)).toEqual(expect.arrayContaining([record.startedAt, record.result!.finishedAt]));

    await deleteLearnerData(OWNER);
    expect(await getDoc(finalKey(mapId))).toBeNull();
    expect((await listKeys("final-submits/")).filter((key) => key.includes(OWNER))).toEqual([]);
  });
});

describe("a written final from before Nov 12", () => {
  async function saveWritten(result?: { passed: boolean; passedCount: number }) {
    const attemptIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of attemptIds) {
      const attempt: Attempt = {
        id,
        mapId,
        nodeId: "final-interview",
        ownerId: OWNER,
        explanation: "",
        integrity: { pasted: false, activeMs: 0, wordCount: 0, inputMethod: "typed" },
        grade: { score: 0, checkpoints: [], misconceptions: [], rejectedQuotes: 0 },
        followUp: { question: "Why?", answer: result ? "Because." : null, passed: result ? true : null, feedback: null },
        status: result ? "proven" : "needs-followup",
        createdAt: new Date().toISOString(),
        format: "final",
      };
      await putDoc(`attempts/${id}`, attempt);
    }
    await putDoc(finalKey(mapId), {
      mapId,
      ownerId: OWNER,
      attemptIds,
      topics: [["Topic a"], ["Topic b"], ["Topic a"]],
      startedAt: "2026-11-01T10:00:00.000Z",
      ...(result && { result: { ...result, finishedAt: "2026-11-01T10:05:00.000Z" } }),
    });
    return attemptIds;
  }

  it("still shows its result as written answers, and still counts as the course badge", async () => {
    await proveEverything();
    await saveWritten({ passed: true, passedCount: 2 });
    expect(await getFinalInterview(OWNER, mapId)).toMatchObject({
      state: "passed",
      format: "written",
      questionCount: 3,
      passMark: 2,
      questions: [],
      result: { passed: true, passedCount: 2 },
    });
    expect(await getPassedFinal(mapId)).toMatchObject({ passedCount: 2, questionCount: 3 });
    expect((await getPassedFinal(mapId))?.format).toBeUndefined();
  });

  it("left unfinished, is replaced by a multiple-choice test, and its questions can no longer be answered", async () => {
    await proveEverything();
    const [attemptId] = await saveWritten();
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("ready");
    await expect(answerFollowUp(OWNER, attemptId, "A typed answer.")).rejects.toMatchObject({ status: 409 });
    expect(mockChatJSON).not.toHaveBeenCalled();

    modelWrites(5);
    expect(await startFinalInterview(OWNER, mapId)).toMatchObject({ state: "in-progress", format: "multiple-choice" });
  });
});

/** Nothing that only the server may know: no key, no explanation, no hint of the original order. */
function expectNoKey(view: FinalView) {
  const json = JSON.stringify(view);
  expect(json).not.toContain("correctIndex");
  expect(json).not.toContain("explanation");
  expect(json).not.toContain("Explanation");
  expect(json).not.toContain("answers");
  expect(view.review).toBeUndefined();
  for (const question of view.questions) expect(Object.keys(question).sort()).toEqual(["options", "question", "topics"]);
}
