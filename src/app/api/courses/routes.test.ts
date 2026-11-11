/**
 * The courses routes end to end, with a fake identity and the in-memory store.
 * The main promise checked here: no response ever carries an owner's id.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId } from "@/shared/identity";
import { saveSkillMap } from "@/features/skill-map";
import type { SkillMap } from "@/shared/types";
import { GET as getCourseRoute, DELETE as unpublishRoute } from "./[mapId]/route";
import { DELETE as unlikeRoute, PUT as likeRoute } from "./[mapId]/like/route";
import { POST as startRoute } from "./[mapId]/start/route";
import { GET as listRoute, POST as publishRoute } from "./route";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn() }));

const OWNER = randomUUID();
const FAN = randomUUID();
const asUser = (id: string) => vi.mocked(getUserId).mockResolvedValue(id);
const ctx = (mapId: string) => ({ params: Promise.resolve({ mapId }) });

let mapId: string;

/** Reads the body and checks it holds no identity. */
async function body(response: Response): Promise<unknown> {
  const text = await response.text();
  for (const secret of [OWNER, FAN, "authorId", "ownerId", "oryxlearn-sample-courses"]) {
    expect(text).not.toContain(secret);
  }
  return JSON.parse(text);
}

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Payroll clerk",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "posting",
    nodes: [
      { id: "a", title: "A", why: "Why A.", prerequisites: [], fromSource: true, citation: null, checkpoints: ["x", "y", "z"] },
    ],
    createdAt: new Date().toISOString(),
  };
  await saveSkillMap(map);
});

function publishRequest(payload: unknown): Request {
  return new Request("http://localhost/api/courses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("courses routes", () => {
  it("publish, view, like, unlike and unpublish, with no identity in any response", async () => {
    asUser(OWNER);
    const published = await publishRoute(publishRequest({ mapId, authorName: "Ana" }));
    expect(published.status).toBe(201);
    expect(await body(published)).toMatchObject({ course: { mapId, authorName: "Ana", likeCount: 0 } });

    asUser(FAN);
    const list = await listRoute(new Request("http://localhost/api/courses?sort=new&q=payroll"));
    expect(await body(list)).toMatchObject({ courses: [{ mapId, title: "Payroll clerk" }] });

    expect(await body(await likeRoute(new Request("http://localhost"), ctx(mapId)))).toEqual({ liked: true, likeCount: 1 });
    expect(await body(await getCourseRoute(new Request("http://localhost"), ctx(mapId)))).toMatchObject({
      published: true,
      isOwner: false,
      likedByMe: true,
    });
    expect(await body(await unlikeRoute(new Request("http://localhost"), ctx(mapId)))).toEqual({ liked: false, likeCount: 0 });

    asUser(OWNER);
    const unpublished = await unpublishRoute(new Request("http://localhost"), ctx(mapId));
    expect(await body(unpublished)).toEqual({ ok: true });

    // Private again: the owner still sees it, anyone else gets a 404.
    expect(await body(await getCourseRoute(new Request("http://localhost"), ctx(mapId)))).toMatchObject({
      course: null,
      published: false,
      isOwner: true,
    });
    asUser(FAN);
    const hidden = await getCourseRoute(new Request("http://localhost"), ctx(mapId));
    expect(hidden.status).toBe(404);
    expect(await body(hidden)).toEqual({ error: expect.stringMatching(/\.$/) });
  });

  it("maps errors to sentences with the right status", async () => {
    asUser(FAN);
    const notYours = await publishRoute(publishRequest({ mapId }));
    expect(notYours.status).toBe(403);
    expect(await body(notYours)).toEqual({ error: expect.any(String) });

    const unreadable = await publishRoute(
      new Request("http://localhost/api/courses", { method: "POST", body: "{nope" }),
    );
    expect(unreadable.status).toBe(400);

    expect((await likeRoute(new Request("http://localhost"), ctx(mapId))).status).toBe(404);
    expect((await listRoute(new Request("http://localhost/api/courses?sort=best"))).status).toBe(400);
    expect((await getCourseRoute(new Request("http://localhost"), ctx("x".repeat(101)))).status).toBe(400);

    asUser(OWNER);
    await publishRoute(publishRequest({ mapId }));
    const ownLike = await likeRoute(new Request("http://localhost"), ctx(mapId));
    expect(ownLike.status).toBe(403);
    expect(await body(ownLike)).toEqual({ error: "You can't like your own course." });
  });

  it("starts a course: 201 with the new copy, then 200 with the same one, and the owner keeps their map", async () => {
    const start = () => startRoute(new Request("http://localhost", { method: "POST" }), ctx(mapId));

    // Private: a 404 for anyone but the owner, with the same sentence as a missing course.
    asUser(FAN);
    const hidden = await start();
    expect(hidden.status).toBe(404);
    const missing = await startRoute(new Request("http://localhost", { method: "POST" }), ctx(randomUUID()));
    expect(await body(hidden)).toEqual(await body(missing));
    expect((await startRoute(new Request("http://localhost", { method: "POST" }), ctx("x".repeat(101)))).status).toBe(400);

    asUser(OWNER);
    const own = await start();
    expect(own.status).toBe(200);
    expect(await body(own)).toEqual({ mapId });
    await publishRoute(publishRequest({ mapId, authorName: "Ana" }));

    asUser(FAN);
    const created = await start();
    expect(created.status).toBe(201);
    const { mapId: copyId } = (await body(created)) as { mapId: string };
    expect(copyId).not.toBe(mapId);
    expect(copyId).toMatch(/^[0-9a-f-]{36}$/);

    const again = await start();
    expect(again.status).toBe(200);
    expect(await body(again)).toEqual({ mapId: copyId });

    // The course page now offers the copy to the learner, and nothing to the owner.
    expect(await body(await getCourseRoute(new Request("http://localhost"), ctx(mapId)))).toMatchObject({
      myCopyId: copyId,
    });
    asUser(OWNER);
    expect(await body(await getCourseRoute(new Request("http://localhost"), ctx(mapId)))).toMatchObject({
      myCopyId: null,
    });
  });

  it("answers 500 with a sentence when something unexpected breaks", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getUserId).mockRejectedValueOnce(new Error("cookie jar exploded"));
    const response = await publishRoute(publishRequest({ mapId }));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("exploded");
    log.mockRestore();
  });
});
