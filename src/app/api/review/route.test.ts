/** The review routes end to end, with a fake identity and the in-memory store. */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId } from "@/shared/identity";
import { putDoc } from "@/shared/store";
import { GET, POST } from "./route";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn() }));

const ME = randomUUID();
const OTHER = randomUUID();
const asUser = (id: string) => vi.mocked(getUserId).mockResolvedValue(id);

async function saveMapWithDeck(ownerId: string): Promise<{ mapId: string; cardId: string }> {
  const mapId = randomUUID();
  const cardId = randomUUID();
  await putDoc(`maps/${mapId}`, {
    id: mapId,
    ownerId,
    title: "Payroll clerk",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "posting",
    nodes: [{ id: "a", title: "Skill A", why: "Why.", prerequisites: [], fromSource: true, citation: null, checkpoints: ["x"] }],
    createdAt: new Date().toISOString(),
  });
  await putDoc(`flashcards/${mapId}/a`, {
    items: [{ id: cardId, mapId, nodeId: "a", front: "Q", back: "A", citation: null }],
    createdAt: new Date().toISOString(),
  });
  return { mapId, cardId };
}

function post(payload: unknown): Request {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  for (const secret of [ME, OTHER, "ownerId", "userId"]) expect(text).not.toContain(secret);
  return JSON.parse(text);
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  for (const name of ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"]) {
    vi.stubEnv(name, "");
  }
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
});

describe("review routes", () => {
  it("GET lists the viewer's cards and POST grades one, with no user id in either", async () => {
    const { mapId, cardId } = await saveMapWithDeck(ME);
    asUser(ME);

    const queue = await body(await GET());
    expect(queue).toMatchObject({
      dueCount: 0,
      newCount: 1,
      moreNew: 0,
      totalCards: 1,
      nextDueAt: null,
      queue: [{ cardId, mapId, nodeId: "a", front: "Q", back: "A", mapTitle: "Payroll clerk", skillTitle: "Skill A", isNew: true }],
    });

    const graded = await POST(post({ mapId, nodeId: "a", cardId, grade: "good" }));
    expect(graded.status).toBe(200);
    expect(await body(graded)).toEqual({ dueAt: expect.any(String), intervalDays: 1 });
    expect(await body(await GET())).toMatchObject({ queue: [], totalCards: 1, nextDueAt: expect.any(String) });
  });

  it("answers someone else's map and a card not in the deck with a 404 sentence", async () => {
    const mine = await saveMapWithDeck(ME);
    const theirs = await saveMapWithDeck(OTHER);
    asUser(ME);

    for (const payload of [
      { mapId: theirs.mapId, nodeId: "a", cardId: theirs.cardId, grade: "good" },
      { mapId: mine.mapId, nodeId: "a", cardId: theirs.cardId, grade: "good" },
    ]) {
      const response = await POST(post(payload));
      expect(response.status).toBe(404);
      expect(await body(response)).toEqual({ error: expect.stringContaining("could not find that flashcard") });
    }
  });

  it("answers a malformed body with a 400 sentence", async () => {
    asUser(ME);
    for (const payload of ["not json", { mapId: "m", nodeId: "a", cardId: "c", grade: "great" }, { grade: "good" }]) {
      const response = await POST(post(payload));
      expect(response.status).toBe(400);
      expect(await body(response)).toEqual({ error: expect.stringContaining("could not read that request") });
    }
  });

  it("answers an unexpected failure with a 500 sentence", async () => {
    vi.mocked(getUserId).mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await body(response)).toEqual({ error: expect.stringContaining("Something went wrong") });
    spy.mockRestore();
  });
});
