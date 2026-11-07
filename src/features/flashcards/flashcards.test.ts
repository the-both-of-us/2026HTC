import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { GENERATION_DEADLINE_MS, getOrCreateFlashcards, getSavedFlashcards, REQUEST_TIMEOUT_MS } from "./flashcards";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

const NODE: SkillNode = {
  id: "sql-joins",
  title: "SQL joins",
  why: "Reports combine tables.",
  prerequisites: [],
  fromSource: true,
  citation: { kind: "posting", quote: "write SQL joins", verified: true },
  checkpoints: ["A LEFT JOIN keeps unmatched left rows", "An INNER JOIN keeps only matches"],
};

const REPLY = {
  cards: Array.from({ length: 6 }, (_, i) => ({ front: `Question ${i + 1}?`, back: `Answer ${i + 1}.` })),
};

let mapId: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();
  mockChatJSON.mockResolvedValue(REPLY);

  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: "owner-user",
    title: "Data analyst",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    nodes: [NODE],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getOrCreateFlashcards", () => {
  it("generates with one model call, then saves the cards", async () => {
    const cards = await getOrCreateFlashcards(mapId, "sql-joins");

    expect(cards).toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledOnce();
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ label: "flashcards", maxTokens: 2000 });
    expect(await getDoc(`flashcards/${mapId}/sql-joins`)).toMatchObject({ items: cards, createdAt: expect.any(String) });
  });

  it("returns saved cards on the second call without calling the model", async () => {
    const first = await getOrCreateFlashcards(mapId, "sql-joins");
    const second = await getOrCreateFlashcards(mapId, "sql-joins");

    expect(second).toEqual(first);
    expect(mockChatJSON).toHaveBeenCalledOnce();
  });

  it("makes one model call for concurrent requests on the same skill", async () => {
    const [a, b, c] = await Promise.all([
      getOrCreateFlashcards(mapId, "sql-joins"),
      getOrCreateFlashcards(mapId, "sql-joins"),
      getOrCreateFlashcards(mapId, "sql-joins"),
    ]);

    expect(mockChatJSON).toHaveBeenCalledOnce();
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("lets a later request try again after a failed generation", async () => {
    mockChatJSON.mockResolvedValueOnce({ cards: [] });
    await expect(getOrCreateFlashcards(mapId, "sql-joins")).rejects.toMatchObject({ status: 502 });
    expect(await getDoc(`flashcards/${mapId}/sql-joins`)).toBeNull();

    await expect(getOrCreateFlashcards(mapId, "sql-joins")).resolves.toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("refuses an unknown map or node, including ids that are not ours, before any model call", async () => {
    await expect(getOrCreateFlashcards(randomUUID(), "sql-joins")).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateFlashcards("../../secrets", "sql-joins")).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateFlashcards(mapId, "nope")).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateFlashcards(mapId, "../maps")).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("keeps the whole model call inside the route's 60 second limit", async () => {
    expect(mockChatJSON).not.toHaveBeenCalled();
    await getOrCreateFlashcards(mapId, "sql-joins");
    expect(mockChatJSON.mock.calls[0][0].timeoutMs).toBe(REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(GENERATION_DEADLINE_MS).toBeLessThan(60_000);
  });

  it("gives up with a 503 sentence when the model runs past the deadline, and saves nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockChatJSON.mockReturnValueOnce(new Promise(() => {}));

    const attempt = getOrCreateFlashcards(mapId, "sql-joins");
    const outcome = expect(attempt).rejects.toMatchObject({ name: "FlashcardsError", status: 503 });
    await vi.advanceTimersByTimeAsync(GENERATION_DEADLINE_MS);
    await outcome;
    expect(await getDoc(`flashcards/${mapId}/sql-joins`)).toBeNull();

    // The in-flight entry is cleared, so the next click tries again.
    await expect(getOrCreateFlashcards(mapId, "sql-joins")).resolves.toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("never stores ownerId", async () => {
    await getOrCreateFlashcards(mapId, "sql-joins");
    expect(JSON.stringify(await getDoc(`flashcards/${mapId}/sql-joins`))).not.toContain("owner-user");
  });
});

describe("getSavedFlashcards", () => {
  it("returns null before any cards exist, without calling the model", async () => {
    expect(await getSavedFlashcards(mapId, "sql-joins")).toBeNull();
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("returns the saved cards once they exist", async () => {
    const cards = await getOrCreateFlashcards(mapId, "sql-joins");
    mockChatJSON.mockClear();

    expect(await getSavedFlashcards(mapId, "sql-joins")).toEqual(cards);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("refuses an unknown map or node", async () => {
    await expect(getSavedFlashcards(randomUUID(), "sql-joins")).rejects.toMatchObject({ status: 404 });
    await expect(getSavedFlashcards(mapId, "nope")).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});
