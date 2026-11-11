import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { answerFollowUp, getFinalInterview, getPassedFinal, startFinalInterview } from "./attempts";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

const OWNER = "owner-user";
let mapId: string;

function modelAsksThree() {
  mockChatJSON.mockResolvedValueOnce({
    questions: [1, 2, 3].map((number) => ({ question: `Question ${number}?`, topics: [1, 2] })),
  });
}

function modelJudges(passed: boolean) {
  mockChatJSON.mockResolvedValueOnce({ passed, feedback: passed ? "Right." : "Not passed." });
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
    sourceKind: "topic",
    sourceText: "",
    nodes: [node("a", []), node("b", ["a"])],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

describe("the final interview", () => {
  it("stays locked until every topic is proven", async () => {
    expect((await getFinalInterview(OWNER, mapId)).state).toBe("locked");
    await expect(startFinalInterview(OWNER, mapId)).rejects.toMatchObject({ status: 403 });
  });

  it("asks three questions, and two passes earn the badge", async () => {
    await proveEverything();
    modelAsksThree();
    const started = await startFinalInterview(OWNER, mapId);
    expect(started.state).toBe("in-progress");
    expect(started.questions.map((question) => question.topics)).toEqual([
      ["Topic a", "Topic b"],
      ["Topic a", "Topic b"],
      ["Topic a", "Topic b"],
    ]);

    // Asking again while it is under way gives the same questions, with no new AI call.
    expect((await startFinalInterview(OWNER, mapId)).questions).toEqual(started.questions);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);

    for (const [index, passed] of [true, false, true].entries()) {
      modelJudges(passed);
      await answerFollowUp(OWNER, started.questions[index].attemptId, "An answer about both topics.", { inputMethod: "voice" });
    }

    const finished = await getFinalInterview(OWNER, mapId);
    expect(finished.state).toBe("passed");
    expect(finished.result).toMatchObject({ passed: true, passedCount: 2, spokenCount: 3 });
    expect(await getPassedFinal(mapId)).toMatchObject({ passedCount: 2 });
  });

  it("one pass of three is not enough, and a retry writes fresh questions", async () => {
    await proveEverything();
    modelAsksThree();
    const started = await startFinalInterview(OWNER, mapId);
    for (const [index, passed] of [true, false, false].entries()) {
      modelJudges(passed);
      await answerFollowUp(OWNER, started.questions[index].attemptId, "An answer.");
    }

    expect((await getFinalInterview(OWNER, mapId)).state).toBe("failed");
    expect(await getPassedFinal(mapId)).toBeNull();

    modelAsksThree();
    const retry = await startFinalInterview(OWNER, mapId);
    expect(retry.state).toBe("in-progress");
    expect(retry.questions[0].attemptId).not.toBe(started.questions[0].attemptId);
  });
});
