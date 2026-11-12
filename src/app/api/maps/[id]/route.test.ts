import { beforeEach, describe, expect, it, vi } from "vitest";
import { readUserId } from "@/shared/identity";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { DELETE, GET } from "./route";

vi.mock("@/shared/identity", () => ({ readUserId: vi.fn() }));
const mockReadUserId = vi.mocked(readUserId);

const OWNER = "secret-owner-id";

async function savedMap(): Promise<SkillMap> {
  const map: SkillMap = {
    id: crypto.randomUUID(),
    ownerId: OWNER,
    title: "Data analyst",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "The posting.",
    nodes: [],
    createdAt: "2026-11-07T10:00:00.000Z",
  };
  await putDoc(`maps/${map.id}`, map);
  return map;
}

function read(id: string) {
  return GET(new Request(`http://test/api/maps/${id}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  mockReadUserId.mockReset();
});

describe("GET /api/maps/[id]", () => {
  it("gives the owner their map, without ownerId", async () => {
    const map = await savedMap();
    mockReadUserId.mockResolvedValue(OWNER);

    const response = await read(map.id);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).id).toBe(map.id);
    expect(text).not.toContain(OWNER);
  });

  it.each([
    ["someone else", "other-user"],
    ["a visitor with no cookie", null],
  ])("refuses %s on a private map, with a sentence that says what to do", async (_name, userId) => {
    const map = await savedMap();
    mockReadUserId.mockResolvedValue(userId);

    const response = await read(map.id);

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(JSON.parse(text).error).toMatch(/private.*build your own/i);
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain("Data analyst");
  });

  it("returns a readable 404 for a map that does not exist", async () => {
    mockReadUserId.mockResolvedValue(OWNER);

    const response = await read(crypto.randomUUID());

    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/could not find/i);
  });
});

function remove(id: string) {
  return DELETE(new Request(`http://test/api/maps/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
}

describe("DELETE /api/maps/[id]", () => {
  it("lets the owner delete their course, and only them", async () => {
    const map = await savedMap();
    mockReadUserId.mockResolvedValue("other-user");
    expect((await remove(map.id)).status).toBe(403);
    expect(await getDoc(`maps/${map.id}`)).not.toBeNull();

    mockReadUserId.mockResolvedValue(OWNER);
    expect((await remove(map.id)).status).toBe(200);
    expect(await getDoc(`maps/${map.id}`)).toBeNull();
    expect((await remove(map.id)).status).toBe(404);
  });

  it("keeps a course that belongs to a program", async () => {
    const map = await savedMap();
    await putDoc(`maps/${map.id}`, { ...map, program: { id: crypto.randomUUID(), title: "P", position: 1, total: 2 } });
    mockReadUserId.mockResolvedValue(OWNER);
    expect((await remove(map.id)).status).toBe(409);
    expect(await getDoc(`maps/${map.id}`)).not.toBeNull();
  });
});
