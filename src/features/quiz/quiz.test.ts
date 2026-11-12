import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, chatJSON } from "@/features/ai";
import { unlockNode } from "@/features/teachback";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import type { QuizQuestion } from "./types";
import { fakeRunning } from "@/shared/store/onceFake";
import { GENERATION_DEADLINE_MS, getOrCreateQuiz, getSavedQuiz, QUIZ_TOTAL_MS } from "./quiz";
import { QuizError, seededRandom } from "./validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));

// The real store, with reads recorded, to prove a refused request never reads the quiz.
vi.mock("@/shared/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/store")>();
  return { ...actual, getDoc: vi.fn(actual.getDoc) };
});
const mockGetDoc = vi.mocked(getDoc);

const OWNER = randomUUID();
const STRANGER = randomUUID();

function makeNode(id: string): SkillNode {
  return {
    id,
    title: id,
    why: "Needed for the job.",
    prerequisites: [],
    fromSource: true,
    citation: null,
    checkpoints: ["One", "Two", "Three"],
  };
}

function modelReply(count = 5) {
  return {
    questions: Array.from({ length: count }, (_, i) => ({
      prompt: `Question ${i + 1}?`,
      options: [`Right ${i}`, `Wrong a ${i}`, `Wrong b ${i}`, `Wrong c ${i}`],
      explanation: `Because ${i}.`,
    })),
  };
}

let mapId: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();
  mockGetDoc.mockClear();

  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Data analyst",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    nodes: [makeNode("first"), makeNode("second")],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOrCreateQuiz", () => {
  it("makes the quiz with one model call and saves it", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());

    const items = await getOrCreateQuiz(mapId, "first", OWNER, { random: seededRandom(1) });

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(mockChatJSON.mock.calls[0][0].label).toBe("quiz");
    expect(mockChatJSON.mock.calls[0][0].prompt).toContain("<skill>");
    expect(items).toHaveLength(5);
    expect(JSON.stringify(items)).not.toContain(OWNER);

    const saved = await getDoc<{ items: QuizQuestion[]; createdAt: string }>(`quiz/${mapId}/first`);
    expect(saved?.items).toEqual(items);
    expect(typeof saved?.createdAt).toBe("string");
  });

  it("returns the saved quiz without calling the model again", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    const first = await getOrCreateQuiz(mapId, "first", OWNER);
    const second = await getOrCreateQuiz(mapId, "first", OWNER);

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("shares one model call between concurrent requests for the same skill", async () => {
    let release: (value: unknown) => void = () => {};
    mockChatJSON.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const calls = [getOrCreateQuiz(mapId, "first", OWNER), getOrCreateQuiz(mapId, "first", OWNER), getOrCreateQuiz(mapId, "first", OWNER)];
    await vi.waitFor(() => expect(mockChatJSON).toHaveBeenCalledTimes(1));
    release(modelReply());
    const [a, b, c] = await Promise.all(calls);

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("makes separate quizzes for separate skills", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply()).mockResolvedValueOnce(modelReply(4));
    const [first, second] = await Promise.all([getOrCreateQuiz(mapId, "first", OWNER), getOrCreateQuiz(mapId, "second", OWNER)]);

    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(first.every((item) => item.nodeId === "first")).toBe(true);
    expect(second.every((item) => item.nodeId === "second")).toBe(true);
  });

  it("lets a later request try again after a failure, and saves nothing", async () => {
    mockChatJSON.mockRejectedValueOnce(new AiUnavailableError());
    await expect(getOrCreateQuiz(mapId, "first", OWNER)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await getDoc(`quiz/${mapId}/first`)).toBeNull();

    mockChatJSON.mockResolvedValueOnce(modelReply());
    await expect(getOrCreateQuiz(mapId, "first", OWNER)).resolves.toHaveLength(5);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("does not save a reply with too few good questions", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply(2));
    await expect(getOrCreateQuiz(mapId, "first", OWNER)).rejects.toBeInstanceOf(QuizError);
    expect(await getDoc(`quiz/${mapId}/first`)).toBeNull();
  });

  it("refuses an unknown map or node with a 404, before any model call", async () => {
    for (const [map, node] of [
      [randomUUID(), "first"],
      ["not-a-uuid", "first"],
      [mapId, "missing"],
      [mapId, "../../maps/x"],
    ]) {
      const error = await getOrCreateQuiz(map, node, OWNER).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(QuizError);
      expect((error as QuizError).status).toBe(404);
    }
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});

describe("getOrCreateQuiz time limits", () => {
  it("keeps the whole model call inside the route's 60 second limit, on the write profile", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    await getOrCreateQuiz(mapId, "first", OWNER, { random: seededRandom(1) });
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ profile: "write", maxTokens: 8_000, totalMs: QUIZ_TOTAL_MS });
    expect("tier" in mockChatJSON.mock.calls[0][0]).toBe(false);
    expect(QUIZ_TOTAL_MS).toBeLessThanOrEqual(45_000);
    expect(GENERATION_DEADLINE_MS).toBeLessThan(60_000);
  });

  it("gives up with a 503 sentence when the model runs past the deadline, and saves nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let giveUp: (error: Error) => void = () => {};
    try {
      // The AI layer itself ends the call at its total timeout, which releases the claim.
      mockChatJSON.mockReturnValueOnce(new Promise((_, reject) => (giveUp = reject)));

      const attempt = getOrCreateQuiz(mapId, "first", OWNER);
      const outcome = expect(attempt).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(GENERATION_DEADLINE_MS);
      await outcome;
      await expect(attempt).rejects.toBeInstanceOf(QuizError);
      expect(await getDoc(`quiz/${mapId}/first`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    giveUp(new AiUnavailableError());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The in-flight entry is cleared, so the next click tries again.
    mockChatJSON.mockResolvedValueOnce(modelReply());
    await expect(getOrCreateQuiz(mapId, "first", OWNER)).resolves.toHaveLength(5);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });
});

describe("a quiz shared by a catalog course", () => {
  async function courseMap(courseId: string, ownerId: string): Promise<string> {
    const id = randomUUID();
    await putDoc(`maps/${id}`, {
      id,
      ownerId,
      courseId,
      title: "Course",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "Course",
      nodes: [makeNode("first")],
      createdAt: new Date().toISOString(),
    } satisfies SkillMap);
    return id;
  }

  it("is written once for two maps of one course, keyed by the course id, each learner seeing their own map id", async () => {
    const courseId = randomUUID();
    const mine = await courseMap(courseId, OWNER);
    const theirs = await courseMap(courseId, STRANGER);
    mockChatJSON.mockResolvedValue(modelReply());

    const [a, b] = await Promise.all([getOrCreateQuiz(mine, "first", OWNER), getOrCreateQuiz(theirs, "first", STRANGER)]);
    const c = await getOrCreateQuiz(theirs, "first", STRANGER);

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(a.every((item) => item.mapId === mine)).toBe(true);
    expect(b.every((item) => item.mapId === theirs)).toBe(true);
    expect(c.map((item) => item.id)).toEqual(a.map((item) => item.id));
    expect(await getDoc(`quiz/${courseId}/first`)).not.toBeNull();
    expect(await getDoc(`quiz/${mine}/first`)).toBeNull();
  });

  it("waits for another writer instead of writing it again", async () => {
    const courseId = randomUUID();
    const mine = await courseMap(courseId, OWNER);
    const stop = fakeRunning(`quiz/${courseId}/first`);
    const waiting = getOrCreateQuiz(mine, "first", OWNER);
    const written = { items: [{ id: "q1", mapId: courseId, nodeId: "first", prompt: "P?", options: ["a", "b"], answerIndex: 0, explanation: "E", citation: null }], createdAt: "x" };
    setTimeout(() => void putDoc(`quiz/${courseId}/first`, written).then(stop), 20);
    expect((await waiting).map((item) => item.mapId)).toEqual([mine]);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});

describe("getSavedQuiz", () => {
  it("returns null when no quiz exists yet, and never calls the model", async () => {
    expect(await getSavedQuiz(mapId, "first", OWNER)).toBeNull();
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("returns the saved quiz", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    const made = await getOrCreateQuiz(mapId, "first", OWNER);
    mockChatJSON.mockReset();

    expect(await getSavedQuiz(mapId, "first", OWNER)).toEqual(made);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("refuses an unknown map or node with a 404", async () => {
    await expect(getSavedQuiz(randomUUID(), "first", OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(getSavedQuiz(mapId, "missing", OWNER)).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});

describe("who may read a map's quiz", () => {
  it("lets the owner read and make a quiz for their private map", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    expect(await getSavedQuiz(mapId, "first", OWNER)).toBeNull();
    await expect(getOrCreateQuiz(mapId, "first", OWNER)).resolves.toHaveLength(5);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });

  it("gives a stranger the same 404 as a missing map, with no model call and no read of the quiz", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    await getOrCreateQuiz(mapId, "first", OWNER);
    mockChatJSON.mockReset();
    mockGetDoc.mockClear();

    const missing = await getSavedQuiz(randomUUID(), "first", STRANGER).catch((error: unknown) => error);
    const refused = [
      await getSavedQuiz(mapId, "first", STRANGER).catch((error: unknown) => error),
      await getOrCreateQuiz(mapId, "first", STRANGER).catch((error: unknown) => error),
      await getOrCreateQuiz(mapId, "second", STRANGER, { random: seededRandom(1) }).catch((error: unknown) => error),
    ];

    expect(missing).toBeInstanceOf(QuizError);
    for (const error of refused) {
      expect(error).toBeInstanceOf(QuizError);
      expect(error).toMatchObject({ status: 404, message: (missing as QuizError).message });
    }
    expect(mockChatJSON).not.toHaveBeenCalled();
    expect(mockGetDoc.mock.calls.map(([key]) => key).filter((key) => key.startsWith("quiz/"))).toEqual([]);
  });

  it("refuses an empty viewer id", async () => {
    await expect(getSavedQuiz(mapId, "first", "")).rejects.toMatchObject({ status: 404 });
  });

  it("does not let a stranger wait on the owner's generation for a private map", async () => {
    let release: (value: unknown) => void = () => {};
    mockChatJSON.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const owners = getOrCreateQuiz(mapId, "first", OWNER);
    await vi.waitFor(() => expect(mockChatJSON).toHaveBeenCalledTimes(1));

    await expect(getOrCreateQuiz(mapId, "first", STRANGER)).rejects.toMatchObject({ status: 404 });
    release(modelReply());
    await expect(owners).resolves.toHaveLength(5);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });
});

describe("a locked skill", () => {
  it("gets nothing made until it is unlocked, and no model call is spent", async () => {
    const lockedMapId = randomUUID();
    await putDoc(`maps/${lockedMapId}`, {
      id: lockedMapId,
      ownerId: OWNER,
      title: "Locked test",
      subtitle: "",
      sourceKind: "posting",
      sourceText: "",
      nodes: [
        { id: "base", title: "Base", why: "", prerequisites: [], fromSource: false, citation: null, checkpoints: ["A"] },
        { id: "later", title: "Later", why: "", prerequisites: ["base"], fromSource: false, citation: null, checkpoints: ["B"] },
      ],
      createdAt: new Date().toISOString(),
    } satisfies SkillMap);
    mockChatJSON.mockClear();

    await expect(getOrCreateQuiz(lockedMapId, "later", OWNER)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("locked") });
    expect(mockChatJSON).not.toHaveBeenCalled();

    await unlockNode(OWNER, lockedMapId, "later");
    mockChatJSON.mockResolvedValueOnce(modelReply());
    await expect(getOrCreateQuiz(lockedMapId, "later", OWNER)).resolves.toBeDefined();
  });
});
