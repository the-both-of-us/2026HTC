import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { publishCourse } from "@/features/courses";
import { unlockNode } from "@/features/teachback";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { AiUnavailableError } from "@/features/ai";
import { DECK_TOTAL_MS, GENERATION_DEADLINE_MS, getOrCreateFlashcards, getSavedFlashcards } from "./flashcards";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));

// The real store, with reads recorded, to prove a refused request never reads the cards.
vi.mock("@/shared/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/store")>();
  return { ...actual, getDoc: vi.fn(actual.getDoc) };
});
const mockGetDoc = vi.mocked(getDoc);

/** Publishing needs owner ids that look like ours. */
const OWNER = randomUUID();
const STRANGER = randomUUID();

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
  mockGetDoc.mockClear();
  mockChatJSON.mockResolvedValue(REPLY);

  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
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
  vi.unstubAllEnvs();
});

function readKeys(): string[] {
  return mockGetDoc.mock.calls.map(([key]) => key);
}

describe("getOrCreateFlashcards", () => {
  it("generates with one model call, then saves the cards", async () => {
    const cards = await getOrCreateFlashcards(mapId, "sql-joins", OWNER);

    expect(cards).toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledOnce();
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ label: "flashcards", maxTokens: 8_000 });
    expect(await getDoc(`flashcards/${mapId}/sql-joins`)).toMatchObject({ items: cards, createdAt: expect.any(String) });
  });

  it("returns saved cards on the second call without calling the model", async () => {
    const first = await getOrCreateFlashcards(mapId, "sql-joins", OWNER);
    const second = await getOrCreateFlashcards(mapId, "sql-joins", OWNER);

    expect(second).toEqual(first);
    expect(mockChatJSON).toHaveBeenCalledOnce();
  });

  it("makes one model call for concurrent requests on the same skill", async () => {
    const [a, b, c] = await Promise.all([
      getOrCreateFlashcards(mapId, "sql-joins", OWNER),
      getOrCreateFlashcards(mapId, "sql-joins", OWNER),
      getOrCreateFlashcards(mapId, "sql-joins", OWNER),
    ]);

    expect(mockChatJSON).toHaveBeenCalledOnce();
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("lets a later request try again after a failed generation", async () => {
    mockChatJSON.mockResolvedValueOnce({ cards: [] });
    await expect(getOrCreateFlashcards(mapId, "sql-joins", OWNER)).rejects.toMatchObject({ status: 502 });
    expect(await getDoc(`flashcards/${mapId}/sql-joins`)).toBeNull();

    await expect(getOrCreateFlashcards(mapId, "sql-joins", OWNER)).resolves.toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("refuses an unknown map or node, including ids that are not ours, before any model call", async () => {
    await expect(getOrCreateFlashcards(randomUUID(), "sql-joins", OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateFlashcards("../../secrets", "sql-joins", OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateFlashcards(mapId, "nope", OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateFlashcards(mapId, "../maps", OWNER)).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("keeps the whole model call inside the route's 60 second limit", async () => {
    expect(mockChatJSON).not.toHaveBeenCalled();
    await getOrCreateFlashcards(mapId, "sql-joins", OWNER);
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ profile: "write", maxTokens: 8_000, totalMs: DECK_TOTAL_MS });
    expect("tier" in mockChatJSON.mock.calls[0][0]).toBe(false);
    expect(GENERATION_DEADLINE_MS).toBeLessThan(60_000);
  });

  it("gives up with a 503 sentence when the model runs past the deadline, and saves nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let giveUp: (error: Error) => void = () => {};
    // The AI layer itself ends the call at its total timeout, which releases the claim.
    mockChatJSON.mockReturnValueOnce(new Promise((_, reject) => (giveUp = reject)));

    const attempt = getOrCreateFlashcards(mapId, "sql-joins", OWNER);
    const outcome = expect(attempt).rejects.toMatchObject({ name: "FlashcardsError", status: 503 });
    await vi.advanceTimersByTimeAsync(GENERATION_DEADLINE_MS);
    await outcome;
    vi.useRealTimers();
    expect(await getDoc(`flashcards/${mapId}/sql-joins`)).toBeNull();
    giveUp(new AiUnavailableError());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The in-flight entry is cleared, so the next click tries again.
    await expect(getOrCreateFlashcards(mapId, "sql-joins", OWNER)).resolves.toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("never stores ownerId", async () => {
    await getOrCreateFlashcards(mapId, "sql-joins", OWNER);
    expect(JSON.stringify(await getDoc(`flashcards/${mapId}/sql-joins`))).not.toContain(OWNER);
  });
});

describe("getSavedFlashcards", () => {
  it("returns null before any cards exist, without calling the model", async () => {
    expect(await getSavedFlashcards(mapId, "sql-joins", OWNER)).toBeNull();
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("returns the saved cards once they exist", async () => {
    const cards = await getOrCreateFlashcards(mapId, "sql-joins", OWNER);
    mockChatJSON.mockClear();

    expect(await getSavedFlashcards(mapId, "sql-joins", OWNER)).toEqual(cards);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("refuses an unknown map or node", async () => {
    await expect(getSavedFlashcards(randomUUID(), "sql-joins", OWNER)).rejects.toMatchObject({ status: 404 });
    await expect(getSavedFlashcards(mapId, "nope", OWNER)).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});

describe("who may read a map's cards", () => {
  const CARDS_KEY = () => `flashcards/${mapId}/sql-joins`;

  it("lets the owner read and make cards for their private map", async () => {
    expect(await getSavedFlashcards(mapId, "sql-joins", OWNER)).toBeNull();
    await expect(getOrCreateFlashcards(mapId, "sql-joins", OWNER)).resolves.toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledOnce();
  });

  it("gives a stranger the same 404 as a missing map, with no model call and no read of the cards", async () => {
    await getOrCreateFlashcards(mapId, "sql-joins", OWNER);
    mockChatJSON.mockClear();
    mockGetDoc.mockClear();

    const missing = await getSavedFlashcards(randomUUID(), "sql-joins", STRANGER).catch((error: unknown) => error);
    const refusedGet = await getSavedFlashcards(mapId, "sql-joins", STRANGER).catch((error: unknown) => error);
    const refusedMake = await getOrCreateFlashcards(mapId, "sql-joins", STRANGER).catch((error: unknown) => error);
    // Even a node that is not on the map: the map itself is what is refused.
    const refusedNode = await getSavedFlashcards(mapId, "nope", STRANGER).catch((error: unknown) => error);

    for (const refused of [refusedGet, refusedMake, refusedNode]) {
      expect(refused).toMatchObject({ name: "FlashcardsError", status: 404, message: (missing as Error).message });
    }
    expect(mockChatJSON).not.toHaveBeenCalled();
    expect(readKeys().filter((key) => key.startsWith("flashcards/"))).toEqual([]);
  });

  it("refuses an empty viewer id", async () => {
    await expect(getSavedFlashcards(mapId, "sql-joins", "")).rejects.toMatchObject({ status: 404 });
  });

  it("lets a stranger read and make cards once the map is published", async () => {
    await publishCourse(mapId, OWNER);

    expect(await getSavedFlashcards(mapId, "sql-joins", STRANGER)).toBeNull();
    const cards = await getOrCreateFlashcards(mapId, "sql-joins", STRANGER);
    expect(cards).toHaveLength(6);
    expect(await getSavedFlashcards(mapId, "sql-joins", STRANGER)).toEqual(cards);
    expect(await getDoc(CARDS_KEY())).toMatchObject({ items: cards });
  });

  it("does not let a stranger wait on the owner's generation for a private map", async () => {
    let release: (value: unknown) => void = () => {};
    mockChatJSON.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const owners = getOrCreateFlashcards(mapId, "sql-joins", OWNER);
    await vi.waitFor(() => expect(mockChatJSON).toHaveBeenCalledOnce());

    await expect(getOrCreateFlashcards(mapId, "sql-joins", STRANGER)).rejects.toMatchObject({ status: 404 });
    release(REPLY);
    await expect(owners).resolves.toHaveLength(6);
    expect(mockChatJSON).toHaveBeenCalledOnce();
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

    await expect(getOrCreateFlashcards(lockedMapId, "later", OWNER)).rejects.toMatchObject({ status: 403, message: expect.stringContaining("locked") });
    expect(mockChatJSON).not.toHaveBeenCalled();

    await unlockNode(OWNER, lockedMapId, "later");
    await expect(getOrCreateFlashcards(lockedMapId, "later", OWNER)).resolves.toBeDefined();
  });
});
