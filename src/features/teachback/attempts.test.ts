import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, chatJSON } from "@/features/ai";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import type { Attempt, IntegritySignals, SkillMap, SkillNode } from "@/shared/types";
import {
  answerFollowUp,
  deleteLearnerData,
  getAttempt,
  getProgress,
  getProgressView,
  isNodeLockedFor,
  startAttempt,
  toLearnerView,
  unlockNode,
  type NewAttempt,
} from "./attempts";

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

const integrity: Omit<IntegritySignals, "wordCount" | "inputMethod"> = { pasted: false, activeMs: 42_000 };

let mapId: string;

function newAttempt(overrides: Partial<NewAttempt> = {}): NewAttempt {
  return { mapId, nodeId: "first", explanation: EXPLANATION, integrity, ...overrides };
}

/**
 * The model's grading reply: both checkpoints met (100, proven at once), only the first (50, a
 * borderline pass that gets a follow-up), or only the first plus a false claim (30, which fails).
 */
function modelGrades(quality: "full" | "pass" | "half") {
  mockChatJSON.mockResolvedValueOnce({
    checkpoints: [
      { number: 1, quote: "keeps only rows that match in both tables" },
      { number: 2, quote: quality === "full" ? "keeps every left row" : null },
    ],
    factualErrors: quality === "half" ? ["They said X, but Y is true."] : [],
  });
  // The second check confirms the flagged error.
  if (quality === "half") mockChatJSON.mockResolvedValueOnce({ confirmed: [1] });
}


function modelJudges(passed: boolean) {
  mockChatJSON.mockResolvedValueOnce({ passed, feedback: passed ? "Right." : "That did not answer it." });
}

/**
 * New attempts never get a follow-up since Nov 9, but ones saved before then can still be
 * answered. This saves one such open attempt: 1 of 2 checkpoints met, with a question waiting.
 */
async function reachFollowUp(nodeId = "first", misconceptions: string[] = []): Promise<Attempt> {
  const attempt: Attempt = {
    id: randomUUID(),
    mapId,
    nodeId,
    ownerId: OWNER,
    explanation: EXPLANATION,
    integrity: { ...integrity, wordCount: EXPLANATION.split(" ").length, inputMethod: "typed" },
    grade: {
      score: 50,
      checkpoints: [
        { checkpoint: "Inner join keeps only matches", quote: "keeps only rows that match in both tables", met: true },
        { checkpoint: "Left join keeps every left row", quote: null, met: false },
      ],
      misconceptions,
      rejectedQuotes: 0,
    },
    followUp: { question: "In your example, what happens to a row with no match?", answer: null, passed: null, feedback: null },
    status: "needs-followup",
    createdAt: new Date().toISOString(),
    timing: { gradeMs: 534, followUpMs: null },
  };
  await putDoc(`attempts/${attempt.id}`, attempt);
  return attempt;
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
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
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

    modelGrades("pass");
    const second = await startAttempt(OWNER, newAttempt());

    expect(second.status).toBe("proven");
  });

  it("a score at the pass mark proves the skill at once: no follow-up question", async () => {
    modelGrades("pass");

    const attempt = await startAttempt(OWNER, newAttempt());

    expect(attempt.grade.score).toBe(50);
    expect(attempt.status).toBe("proven");
    expect(attempt.followUp).toBeNull();
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect((await getProgress(mapId, OWNER))?.proven).toEqual({ first: attempt.id });
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

  it("saves how the follow-up was answered, and leaves the delay out when the page didn't say", async () => {
    const timed = await reachFollowUp();
    modelJudges(true);
    const finished = await answerFollowUp(OWNER, timed.id, "It stays.", { startedAfterMs: 8_400.6 });
    expect(finished.followUp).toMatchObject({ inputMethod: "typed", startedAfterMs: 8_401 });
    expect((await getAttempt(timed.id))?.followUp?.inputMethod).toBe("typed");

    // "second" unlocked when "first" was proven. A page that sends only the answer still works.
    const plain = await reachFollowUp("second");
    modelJudges(true);
    const old = await answerFollowUp(OWNER, plain.id, "It stays.");
    expect(old.followUp).toMatchObject({ inputMethod: "typed" });
    expect(old.followUp).not.toHaveProperty("startedAfterMs");
  });

  it("a strong explanation is proven at once, with no follow-up question", async () => {
    modelGrades("full");

    const attempt = await startAttempt(OWNER, newAttempt());

    expect(attempt.grade.score).toBe(100);
    expect(attempt.status).toBe("proven");
    expect(attempt.followUp).toBeNull();
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect((await getProgress(mapId, OWNER))?.proven.first).toBe(attempt.id);
    expect((await getProgressView(OWNER, mapId)).states.second).toBe("available");
  });

  it("Explain it to a 10-year-old: a hard reading level is a tip, never a fail", async () => {
    // The third topic with no prerequisites gets "kid" in the format rotation.
    const nodes = [makeNode("a", []), makeNode("b", []), makeNode("kid", [])];
    await putDoc(`maps/${mapId}`, { ...((await getDoc(`maps/${mapId}`)) as SkillMap), nodes });
    modelGrades("full");
    const runOn =
      "An inner join keeps only rows that match in both tables while a left join keeps every left row and fills the missing columns with NULL values so that unmatched customers and their information still appear in the combined output that the database engine returns afterwards.";

    const attempt = await startAttempt(OWNER, newAttempt({ nodeId: "kid", format: "kid", explanation: runOn }));

    expect(attempt.plainLanguage?.passed).toBe(false);
    expect(attempt.status).toBe("proven");
  });

  it("2 of 3 checkpoints is strong enough to skip the follow-up", async () => {
    const node = { ...makeNode("first", []), checkpoints: ["One fact", "Two fact", "Three fact"] };
    await putDoc(`maps/${mapId}`, { ...(await getDoc(`maps/${mapId}`) as SkillMap), nodes: [node] });
    mockChatJSON.mockResolvedValueOnce({
      checkpoints: [
        { number: 1, quote: "keeps only rows that match in both tables" },
        { number: 2, quote: "keeps every left row" },
        { number: 3, quote: null },
      ],
      factualErrors: [],
    });
     const attempt = await startAttempt(OWNER, newAttempt());

    expect(attempt.grade.score).toBe(67);
    expect(attempt.status).toBe("proven");
    expect(attempt.followUp).toBeNull();
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

  it("answers sent at the same time get one try between them", async () => {
    const attempt = await reachFollowUp();
    // Only the first judgement is queued: a second model call would have no reply and throw.
    modelJudges(false);
    mockChatJSON.mockClear();

    const results = await Promise.allSettled(
      ["one", "two", "three", "four", "five"].map((answer) => answerFollowUp(OWNER, attempt.id, answer)),
    );

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(4);
    expect((await getAttempt(attempt.id))?.status).toBe("not-yet");
    expect(await getProgress(mapId, OWNER)).toBeNull();
  });

  it("gives the try back if the model could not answer", async () => {
    const attempt = await reachFollowUp();
    mockChatJSON.mockRejectedValueOnce(new AiUnavailableError());
    await expect(answerFollowUp(OWNER, attempt.id, "A real answer.")).rejects.toBeInstanceOf(AiUnavailableError);

    modelJudges(true);
    const finished = await answerFollowUp(OWNER, attempt.id, "A real answer.");
    expect(finished.status).toBe("proven");
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

describe("sending several answers at once", () => {
  it("grades one and refuses the rest, so a later fail can't overwrite a pass", async () => {
    const attempt = await reachFollowUp();
    mockChatJSON.mockClear();
    modelJudges(true);

    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) => answerFollowUp(OWNER, attempt.id, `Answer ${n}.`)),
    );

    expect(mockChatJSON).toHaveBeenCalledOnce();
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(4);
    expect((await getAttempt(attempt.id))?.status).toBe("proven");
    expect((await getProgress(mapId, OWNER))?.proven).toEqual({ first: attempt.id });
  });

  it("gives the retry back if the model call fails", async () => {
    const attempt = await reachFollowUp();
    mockChatJSON.mockRejectedValueOnce(new Error("The model is down."));
    await expect(answerFollowUp(OWNER, attempt.id, "An answer.")).rejects.toThrow("The model is down.");

    modelJudges(true);
    const finished = await answerFollowUp(OWNER, attempt.id, "An answer.");

    expect(finished.status).toBe("proven");
  });

  it("takes over a claim left behind by a server that died", async () => {
    const attempt = await reachFollowUp();
    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await putDoc(`attempts/${attempt.id}/claim`, { claimedAt: longAgo });

    modelJudges(true);
    const finished = await answerFollowUp(OWNER, attempt.id, "An answer.");

    expect(finished.status).toBe("proven");
  });

  it("refuses while a recent claim is still open", async () => {
    const attempt = await reachFollowUp();
    await putDoc(`attempts/${attempt.id}/claim`, { claimedAt: new Date().toISOString() });

    await expect(answerFollowUp(OWNER, attempt.id, "An answer.")).rejects.toMatchObject({ status: 409 });
  });
});

describe("two skills proven at the same moment", () => {
  it("keeps both", async () => {
    await putDoc(`maps/${mapId}`, {
      id: mapId,
      ownerId: OWNER,
      title: "Test map",
      subtitle: "",
      sourceKind: "posting",
      sourceText: "",
      nodes: [makeNode("first", []), makeNode("other", [])],
      createdAt: new Date().toISOString(),
    });
    const a = await reachFollowUp("first");
    const b = await reachFollowUp("other");
    modelJudges(true);
    modelJudges(true);

    await Promise.all([answerFollowUp(OWNER, a.id, "An answer."), answerFollowUp(OWNER, b.id, "An answer.")]);

    expect((await getProgress(mapId, OWNER))?.proven).toEqual({ first: a.id, other: b.id });
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
  it("measures grading and the follow-up on the server, and sends the times to the learner", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(1_534.4);
    modelGrades("half");
    const graded = await startAttempt(OWNER, newAttempt());
    expect(graded.timing).toEqual({ gradeMs: 534, followUpMs: null });
    expect(toLearnerView(graded).timing).toEqual({ gradeMs: 534, followUpMs: null });

    const attempt = await reachFollowUp();

    vi.spyOn(performance, "now").mockReturnValueOnce(2_000).mockReturnValueOnce(2_401);
    modelJudges(true);
    const finished = await answerFollowUp(OWNER, attempt.id, "It stays, with NULLs on the right.");
    expect(finished.timing).toEqual({ gradeMs: 534, followUpMs: 401 });
    vi.restoreAllMocks();
  });

  it("counts the words on the server, whatever the client claims", async () => {
    modelGrades("half");
    const claimed = { ...integrity, wordCount: 9999 };

    const attempt = await startAttempt(OWNER, newAttempt({ integrity: claimed }));

    expect(attempt.integrity.wordCount).toBe(EXPLANATION.split(" ").length);
  });

  it("caps the active time a browser can claim", async () => {
    modelGrades("half");

    const attempt = await startAttempt(OWNER, newAttempt({ integrity: { ...integrity, activeMs: 999_999_999 } }));

    expect(attempt.integrity.activeMs).toBe(60 * 60 * 1000);
  });

  it("never stores the model's reason for a failed follow-up, which could be pasted back as the answer", async () => {
    const attempt = await reachFollowUp();
    mockChatJSON.mockResolvedValueOnce({ passed: false, feedback: "You need to say the row stays, with NULLs." });

    const finished = await answerFollowUp(OWNER, attempt.id, "Not sure.");

    expect(finished.followUp?.feedback).toBe("That answer did not show it.");
    expect(JSON.stringify(await getAttempt(attempt.id))).not.toContain("the row stays");
  });

  it("never sends ownerId, which is the identity cookie", async () => {
    const view = toLearnerView(await reachFollowUp());
    expect(view).not.toHaveProperty("ownerId");
  });

  it("holds back missed checkpoints and misconceptions while a follow-up is open, then returns them", async () => {
    const attempt = await reachFollowUp("first", ["A false claim."]);
    expect(toLearnerView(attempt).grade.misconceptions).toEqual([]);

    modelJudges(false);
    const finished = await answerFollowUp(OWNER, attempt.id, "Not sure.");

    expect(toLearnerView(finished).grade.misconceptions).toEqual(["A false claim."]);
  });
});

describe("unlock anyway", () => {
  it("opens a locked skill for its owner, saves it, and lets them prove it", async () => {
    const view = await unlockNode(OWNER, mapId, "second");

    expect(view.states.second).toBe("available");
    expect(Object.keys(view.unlocked)).toEqual(["second"]);
    expect((await getProgress(mapId, OWNER))?.unlocked?.second).toEqual(expect.any(String));

    modelGrades("full");
    await expect(startAttempt(OWNER, newAttempt({ nodeId: "second" }))).resolves.toMatchObject({ nodeId: "second" });
  });

  it("changes nothing for a skill that is already open", async () => {
    const view = await unlockNode(OWNER, mapId, "first");
    expect(view.unlocked).toEqual({});
    expect(await listKeys(`unlocks/${mapId}/`)).toEqual([]);
  });

  it("refuses someone else's map and a skill that is not on it", async () => {
    await expect(unlockNode("other-user", mapId, "second")).rejects.toMatchObject({ status: 403 });
    await expect(unlockNode(OWNER, mapId, "../nope")).rejects.toMatchObject({ status: 404 });
    expect(await listKeys(`unlocks/${mapId}/`)).toEqual([]);
  });

  it("tells other features whether a skill is still locked for a viewer", async () => {
    const map = (await getDoc<SkillMap>(`maps/${mapId}`))!;
    expect(await isNodeLockedFor(map, OWNER, "second")).toBe(true);
    expect(await isNodeLockedFor(map, OWNER, "first")).toBe(false);

    await unlockNode(OWNER, mapId, "second");
    expect(await isNodeLockedFor(map, OWNER, "second")).toBe(false);
    // Someone else's unlock never opens a skill for a reader of the course.
    expect(await isNodeLockedFor(map, "reader", "second")).toBe(true);
  });

  it("is removed by Delete my data", async () => {
    await unlockNode(OWNER, mapId, "second");
    await deleteLearnerData(OWNER);
    expect(await listKeys(`unlocks/${mapId}/${OWNER}/`)).toEqual([]);
  });
});
