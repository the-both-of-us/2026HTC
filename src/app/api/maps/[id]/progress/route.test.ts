import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId } from "@/shared/identity";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { GET } from "./route";

vi.mock("@/shared/identity", () => ({ getUserId: vi.fn() }));
const mockGetUserId = vi.mocked(getUserId);

const OWNER = "secret-owner-id";

async function savedMap(): Promise<SkillMap> {
  const node = (id: string, prerequisites: string[] = []) => ({
    id,
    title: id,
    why: "Useful.",
    prerequisites,
    fromSource: false,
    citation: null,
    checkpoints: ["The answer key"],
  });
  const map: SkillMap = {
    id: crypto.randomUUID(),
    ownerId: OWNER,
    title: "Data analyst",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "The posting.",
    nodes: [node("secret-first-node"), node("secret-second-node", ["secret-first-node"])],
    createdAt: "2026-11-07T10:00:00.000Z",
  };
  await putDoc(`maps/${map.id}`, map);
  await putDoc(`progress/${map.id}/${OWNER}/secret-first-node`, {
    nodeId: "secret-first-node",
    attemptId: "attempt-1",
    provenAt: "2026-11-07T11:00:00.000Z",
  });
  return map;
}

function read(id: string) {
  return GET(new Request(`http://test/api/maps/${id}/progress`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  mockGetUserId.mockReset();
});

describe("GET /api/maps/[id]/progress", () => {
  it("gives the owner their progress", async () => {
    const map = await savedMap();
    mockGetUserId.mockResolvedValue(OWNER);

    const response = await read(map.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      isOwner: true,
      mapId: map.id,
      proven: { "secret-first-node": "attempt-1" },
      unlocked: {},
      states: { "secret-first-node": "proven", "secret-second-node": "available" },
      knownByPretest: [],
    });
  });

  it("tells anyone else it isn't theirs with a 200, and nothing about the map or its owner", async () => {
    const map = await savedMap();
    mockGetUserId.mockResolvedValue("other-user");

    const response = await read(map.id);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ isOwner: false, proven: {}, unlocked: {} });
    for (const secret of [OWNER, "secret-first-node", "attempt-1", "answer key"]) expect(text).not.toContain(secret);
  });

  it("still answers 404 for a map that does not exist", async () => {
    mockGetUserId.mockResolvedValue("other-user");
    const response = await read(crypto.randomUUID());
    expect(response.status).toBe(404);
  });
});
