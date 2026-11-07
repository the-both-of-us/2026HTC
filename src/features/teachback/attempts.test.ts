import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { putDoc } from "@/shared/store";
import type { Attempt, IntegritySignals, SkillMap, SkillNode } from "@/shared/types";
import { answerFollowUp, getAttempt, getProgress, getProgressView, startAttempt, toLearnerView, type NewAttempt } from "./attempts";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

const OWNER = "owner-user";
const EXPLANATION =
  "An inner join keeps only rows that match in both tables, while a left join keeps every left row and fills the rest with NULL.";

function makeNode(id: string, prerequisites: string[]): SkillNode {
  return {
    id,
    title: id,
    why: "Needed for the job.",
    prerequisites,
    fromSource: true,
    citation: null,
    checkpoints: ["Inner join keeps only matches", "Left join keeps every left row"],
  };
}

const integrity: Omit<IntegritySignals, "wordCount"> = { pasted: false, activeMs: 42_000, inputMethod: "typed" };

let mapId: string;

function newAttempt(overrides: Partial<NewAttempt> = {}): NewAttempt {
  return { mapId, nodeId: "first", explanation: EXPLANATION, integrity, ...overrides };
}

/** The model's grading reply: both checkpoints met, or only the first (a 50, which fails). */
function modelGrades(quality: "full" | "half") {
  mockChatJSON.mockResolvedValueOnce({
    checkpoints: [
      { number: 1, quote: "keeps only rows that match in both tables" },
      { number: 2, quote: quality === "full" ? "keeps every left row" : null },
    ],
    factualErrors: quality === "full" ? [] : ["They said X, but Y is true."],
  });
}

function modelAsks() {
  mockChatJSON.mockResolvedValueOnce({ question: "In your example, what happens to a row with no match?" });
}

function modelJudges(passed: boolean) {
  mockChatJSON.mockResolvedValueOnce({ passed, feedback: passed ? "Right." : "That did not answer it." });
}

async function reachFollowUp(nodeId = "first"): Promise<Attempt> {
  modelGrades("full");
  modelAsks();
  return startAttempt(OWNER, newAttempt({ nodeId }));
}

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();

  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Test map",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    nodes: [makeNode("first", []), makeNode("second", ["first"])],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

describe("status transitions", () => {
  it("a score below the pass mark gives not-yet, with no follow-up", async () => {
    modelGrades("half");

    const attempt = await startAttempt(OWNER, newAttempt());

    expect(attempt.grade.score).toBe(30);
    expect(attempt.status).toBe("not-yet");
    expect(attempt.followUp).toBeNull();
    expect(mockChatJSON).toHaveBeenCalledOnce();
  });

  it("not-yet returns the misconceptions and missed checkpoints", async () => {
    modelGrades("half");

    const view = toLearnerView(await startAttempt(OWNER, newAttempt()));

    expect(view.grade.misconceptions).toEqual(["They said X, but Y is true."]);
    expect(view.grade.checkpoints.filter((result) => !result.met)).toHaveLength(1);
  });

  it("a learner can retry after not-yet", async () => {
    modelGrades("half");
    await startAttempt(OWNER, newAttempt());

    const second = await reachFollowUp();

    expect(second.status).toBe("needs-followup");
  });

  it("a score at the pass mark gives needs-followup, and does not prove the node yet", async () => {
    const attempt = await reachFollowUp();

    expect(attempt.status).toBe("needs-followup");
    expect(attempt.followUp?.question).toContain("your example");
    expect(attempt.followUp?.answer).toBeNull();
    expect(await getProgress(mapId, OWNER)).toBeNull();
  });

  it("a passed follow-up gives proven, updates progress and unlocks the next node", async () => {
    const attempt = await reachFollowUp();
    modelJudges(true);

    const finished = await answerFollowUp(OWNER, attempt.id, "It stays, with NULLs on the right.");

    expect(finished.status).toBe("proven");
    expect(finished.followUp).toMatchObject({ passed: true, feedback: "Right." });
    expect((await getProgress(mapId, OWNER))?.proven).toEqual({ first: attempt.id });
    expect((await getAttempt(attempt.id))?.status).toBe("proven");

    const view = await getProgressView(OWNER, mapId);
    expect(view.states).toEqual({ first: "proven", second: "available" });
  });

  it("a failed follow-up gives not-yet and leaves the node unproven", async () => {
    const attempt = await reachFollowUp();
    modelJudges(false);

    const finished = await answerFollowUp(OWNER, attempt.id, "I am not sure.");

    expect(finished.status).toBe("not-yet");
    expect(await getProgress(mapId, OWNER)).toBeNull();
  });

  it("an empty follow-up answer fails without calling the model", async () => {
    const attempt = await reachFollowUp();
    mockChatJSON.mockClear();

    const finished = await answerFollowUp(OWNER, attempt.id, "   \n ");

    expect(finished.status).toBe("not-yet");
    expect(finished.followUp?.passed).toBe(false);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("a finished attempt cannot be answered again", async () => {
    const attempt = await reachFollowUp();
    modelJudges(false);
    await answerFollowUp(OWNER, attempt.id, "No idea.");

    await expect(answerFollowUp(OWNER, attempt.id, "Second try.")).rejects.toMatchObject({ status: 409 });
  });

  it("a not-yet attempt has no follow-up to answer", async () => {
    modelGrades("half");
    const attempt = await startAttempt(OWNER, newAttempt());

    await expect(answerFollowUp(OWNER, attempt.id, "Anything.")).rejects.toMatchObject({ status: 409 });
  });

  it("a proven node cannot be attempted again", async () => {
    const attempt = await reachFollowUp();
    modelJudges(true);
    await answerFollowUp(OWNER, attempt.id, "A real answer.");

    await expect(startAttempt(OWNER, newAttempt())).rejects.toMatchObject({ status: 409 });
  });
});

describe("what the server refuses", () => {
  it("a locked node, before spending a model call", async () => {
    await expect(startAttempt(OWNER, newAttempt({ nodeId: "second" }))).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("locked"),
    });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("someone else's map", async () => {
    await expect(startAttempt("other-user", newAttempt())).rejects.toMatchObject({ status: 403 });
    await expect(getProgressView("other-user", mapId)).rejects.toMatchObject({ status: 403 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("someone else's attempt", async () => {
    const attempt = await reachFollowUp();
    mockChatJSON.mockClear();

    await expect(answerFollowUp("other-user", attempt.id, "An answer.")).rejects.toMatchObject({ status: 403 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("a map, node or attempt that does not exist, including ids that are not ours", async () => {
    await expect(startAttempt(OWNER, newAttempt({ mapId: randomUUID() }))).rejects.toMatchObject({ status: 404 });
    await expect(startAttempt(OWNER, newAttempt({ mapId: "../../secrets" }))).rejects.toMatchObject({ status: 404 });
    await expect(startAttempt(OWNER, newAttempt({ nodeId: "nope" }))).rejects.toMatchObject({ status: 404 });
    await expect(answerFollowUp(OWNER, "../maps/x", "An answer.")).rejects.toMatchObject({ status: 404 });
  });

  it("fewer than 15 words, with a helpful message", async () => {
    await expect(startAttempt(OWNER, newAttempt({ explanation: "Joins combine two tables." }))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("at least 15 words"),
    });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("an explanation or answer that is far too long", async () => {
    await expect(startAttempt(OWNER, newAttempt({ explanation: "word ".repeat(2000) }))).rejects.toMatchObject({ status: 400 });

    const attempt = await reachFollowUp();
    await expect(answerFollowUp(OWNER, attempt.id, "x".repeat(2001))).rejects.toMatchObject({ status: 400 });
  });
});

describe("what is stored and sent", () => {
  it("counts the words on the server, whatever the client claims", async () => {
    modelGrades("half");
    const claimed = { ...integrity, wordCount: 9999 };

    const attempt = await startAttempt(OWNER, newAttempt({ integrity: claimed }));

    expect(attempt.integrity.wordCount).toBe(EXPLANATION.split(" ").length);
  });

  it("never sends ownerId, which is the identity cookie", async () => {
    const view = toLearnerView(await reachFollowUp());
    expect(view).not.toHaveProperty("ownerId");
  });

  it("holds back missed checkpoints and misconceptions while a follow-up is open, then returns them", async () => {
    mockChatJSON.mockResolvedValueOnce({
      checkpoints: [
        { number: 1, quote: "keeps only rows that match in both tables" },
        { number: 2, quote: "keeps every left row" },
      ],
      factualErrors: ["A false claim."],
    });
    modelAsks();
    const attempt = await startAttempt(OWNER, newAttempt());
    expect(attempt.status).toBe("needs-followup");
    expect(toLearnerView(attempt).grade.misconceptions).toEqual([]);

    modelJudges(false);
    const finished = await answerFollowUp(OWNER, attempt.id, "Not sure.");

    expect(toLearnerView(finished).grade.misconceptions).toEqual(["A false claim."]);
  });
});
