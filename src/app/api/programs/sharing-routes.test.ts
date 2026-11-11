/**
 * The program sharing routes end to end, with a fake identity and the in-memory store.
 * The main promise checked here: no response ever carries an owner's id or source text.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId } from "@/shared/identity";
import { putDoc } from "@/shared/store";
import { DELETE as unshareRoute, POST as shareRoute } from "./[id]/share/route";
import { POST as startRoute } from "./[id]/start/route";
import { GET as listRoute } from "./public/route";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn().mockRejectedValue(new Error("No AI in tests")),
}));
vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn() }));

const SOURCE = "I want to learn backend development for my own app";
const OWNER = randomUUID();
const LEARNER = randomUUID();
const asUser = (id: string) => vi.mocked(getUserId).mockResolvedValue(id);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Reads the body and checks it holds nothing private. */
async function body(response: Response): Promise<unknown> {
  const text = await response.text();
  for (const secret of [OWNER, LEARNER, "authorId", "ownerId", "sourceText", SOURCE]) {
    expect(text).not.toContain(secret);
  }
  return JSON.parse(text);
}

const shareRequest = (payload: unknown) =>
  new Request("http://localhost/api/programs/x/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

let programId: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  programId = randomUUID();
  // A program as the store holds it; the programs feature reads it like any other.
  await putDoc(`programs/${programId}`, {
    id: programId,
    ownerId: OWNER,
    title: "Backend development",
    summary: "From an HTTP API to a deployed service.",
    sourceKind: "topic",
    sourceText: SOURCE,
    courses: [
      { slug: "http-apis", title: "HTTP APIs", summary: "Build an API.", requires: [] },
      { slug: "databases", title: "Databases", summary: "Store data.", requires: ["http-apis"] },
    ],
    createdAt: new Date().toISOString(),
  });
});

describe("program sharing routes", () => {
  it("share, list, start and make private, with nothing private in any response", async () => {
    asUser(LEARNER);
    expect((await startRoute(new Request("http://localhost"), ctx(programId))).status).toBe(404);
    expect((await shareRoute(shareRequest({ authorName: "Mallory" }), ctx(programId))).status).toBe(404);

    asUser(OWNER);
    const shared = await shareRoute(shareRequest({ authorName: "Ana" }), ctx(programId));
    expect(shared.status).toBe(201);
    expect(await body(shared)).toMatchObject({ program: { programId, authorName: "Ana" } });

    const listed = await listRoute(new Request("http://localhost/api/programs/public?q=ana"));
    expect(await body(listed)).toMatchObject({ programs: [{ programId }] });

    asUser(LEARNER);
    const started = await startRoute(new Request("http://localhost"), ctx(programId));
    expect(started.status).toBe(201);
    const { programId: copyId } = (await body(started)) as { programId: string };
    expect(copyId).not.toBe(programId);
    const again = await startRoute(new Request("http://localhost"), ctx(programId));
    expect(again.status).toBe(200);
    expect(await body(again)).toEqual({ programId: copyId });

    asUser(OWNER);
    const unshared = await unshareRoute(new Request("http://localhost"), ctx(programId));
    expect(await body(unshared)).toEqual({ ok: true });
    expect(await body(await listRoute(new Request("http://localhost/api/programs/public")))).toEqual({ programs: [] });
  });

  it("answers bad input with a sentence", async () => {
    asUser(OWNER);
    const tooLong = await shareRoute(shareRequest({ authorName: "x".repeat(41) }), ctx(programId));
    expect(tooLong.status).toBe(400);
    expect(await body(tooLong)).toHaveProperty("error");
    const garbage = await shareRoute(shareRequest({ authorName: 5 }), ctx(programId));
    expect(garbage.status).toBe(400);
    expect((await shareRoute(shareRequest({}), ctx("not-a-uuid"))).status).toBe(404);
  });
});
