import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, chatJSON } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import type { QuizQuestion } from "./types";
import { GENERATION_DEADLINE_MS, getOrCreateQuiz, getSavedQuiz, REQUEST_TIMEOUT_MS } from "./quiz";
import { QuizError, seededRandom } from "./validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

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

  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: "owner-user",
    title: "Data analyst",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    nodes: [makeNode("first"), makeNode("second")],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

describe("getOrCreateQuiz", () => {
  it("makes the quiz with one model call and saves it", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());

    const items = await getOrCreateQuiz(mapId, "first", { random: seededRandom(1) });

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(mockChatJSON.mock.calls[0][0].label).toBe("quiz");
    expect(mockChatJSON.mock.calls[0][0].prompt).toContain("<skill>");
    expect(items).toHaveLength(5);
    expect(JSON.stringify(items)).not.toContain("owner-user");

    const saved = await getDoc<{ items: QuizQuestion[]; createdAt: string }>(`quiz/${mapId}/first`);
    expect(saved?.items).toEqual(items);
    expect(typeof saved?.createdAt).toBe("string");
  });

  it("returns the saved quiz without calling the model again", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    const first = await getOrCreateQuiz(mapId, "first");
    const second = await getOrCreateQuiz(mapId, "first");

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("shares one model call between concurrent requests for the same skill", async () => {
    let release: (value: unknown) => void = () => {};
    mockChatJSON.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const calls = [getOrCreateQuiz(mapId, "first"), getOrCreateQuiz(mapId, "first"), getOrCreateQuiz(mapId, "first")];
    await vi.waitFor(() => expect(mockChatJSON).toHaveBeenCalledTimes(1));
    release(modelReply());
    const [a, b, c] = await Promise.all(calls);

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("makes separate quizzes for separate skills", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply()).mockResolvedValueOnce(modelReply(4));
    const [first, second] = await Promise.all([getOrCreateQuiz(mapId, "first"), getOrCreateQuiz(mapId, "second")]);

    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(first.every((item) => item.nodeId === "first")).toBe(true);
    expect(second.every((item) => item.nodeId === "second")).toBe(true);
  });

  it("lets a later request try again after a failure, and saves nothing", async () => {
    mockChatJSON.mockRejectedValueOnce(new AiUnavailableError());
    await expect(getOrCreateQuiz(mapId, "first")).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await getDoc(`quiz/${mapId}/first`)).toBeNull();

    mockChatJSON.mockResolvedValueOnce(modelReply());
    await expect(getOrCreateQuiz(mapId, "first")).resolves.toHaveLength(5);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("does not save a reply with too few good questions", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply(2));
    await expect(getOrCreateQuiz(mapId, "first")).rejects.toBeInstanceOf(QuizError);
    expect(await getDoc(`quiz/${mapId}/first`)).toBeNull();
  });

  it("refuses an unknown map or node with a 404, before any model call", async () => {
    for (const [map, node] of [
      [randomUUID(), "first"],
      ["not-a-uuid", "first"],
      [mapId, "missing"],
      [mapId, "../../maps/x"],
    ]) {
      const error = await getOrCreateQuiz(map, node).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(QuizError);
      expect((error as QuizError).status).toBe(404);
    }
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});

describe("getOrCreateQuiz time limits", () => {
  it("keeps the whole model call inside the route's 60 second limit", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    await getOrCreateQuiz(mapId, "first", { random: seededRandom(1) });
    expect(mockChatJSON.mock.calls[0][0].timeoutMs).toBe(REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(GENERATION_DEADLINE_MS).toBeLessThan(60_000);
  });

  it("gives up with a 503 sentence when the model runs past the deadline, and saves nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mockChatJSON.mockReturnValueOnce(new Promise(() => {}));

      const attempt = getOrCreateQuiz(mapId, "first");
      const outcome = expect(attempt).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(GENERATION_DEADLINE_MS);
      await outcome;
      await expect(attempt).rejects.toBeInstanceOf(QuizError);
      expect(await getDoc(`quiz/${mapId}/first`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // The in-flight entry is cleared, so the next click tries again.
    mockChatJSON.mockResolvedValueOnce(modelReply());
    await expect(getOrCreateQuiz(mapId, "first")).resolves.toHaveLength(5);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });
});

describe("getSavedQuiz", () => {
  it("returns null when no quiz exists yet, and never calls the model", async () => {
    expect(await getSavedQuiz(mapId, "first")).toBeNull();
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("returns the saved quiz", async () => {
    mockChatJSON.mockResolvedValueOnce(modelReply());
    const made = await getOrCreateQuiz(mapId, "first");
    mockChatJSON.mockReset();

    expect(await getSavedQuiz(mapId, "first")).toEqual(made);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("refuses an unknown map or node with a 404", async () => {
    await expect(getSavedQuiz(randomUUID(), "first")).rejects.toMatchObject({ status: 404 });
    await expect(getSavedQuiz(mapId, "missing")).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});
