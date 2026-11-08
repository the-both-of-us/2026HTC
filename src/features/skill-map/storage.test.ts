import { describe, expect, it } from "vitest";
import { deleteDoc, getDoc, listDocs, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { SkillMapError } from "./build";
import { copySkillMap, deleteSkillMap, getSkillMap, listMapsByOwner, saveSkillMap, toPublicMap } from "./storage";

function makeMap(overrides: Partial<SkillMap> = {}): SkillMap {
  return {
    id: crypto.randomUUID(),
    ownerId: "author",
    title: "Data analyst",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "The posting.",
    nodes: [
      {
        id: "sql",
        title: "SQL",
        why: "The job uses it.",
        prerequisites: [],
        fromSource: true,
        citation: null,
        checkpoints: ["A", "B", "C"],
      },
    ],
    createdAt: "2026-11-07T10:00:00.000Z",
    ...overrides,
  };
}

describe("copySkillMap", () => {
  it("saves a copy under a new id and owner, keeps the nodes and records the source", async () => {
    const source = makeMap();
    await saveSkillMap(source);

    const copy = await copySkillMap(source.id, "learner");

    expect(copy.id).not.toBe(source.id);
    expect(copy.ownerId).toBe("learner");
    expect(copy.nodes).toEqual(source.nodes);
    expect(copy.forkedFrom).toBe(source.id);
    expect(await getSkillMap(copy.id)).toEqual(copy);
  });

  it("leaves the original unchanged", async () => {
    const source = makeMap();
    await saveSkillMap(source);

    await copySkillMap(source.id, "learner");

    expect(await getSkillMap(source.id)).toEqual(source);
  });

  it("does not copy progress", async () => {
    const source = makeMap();
    await saveSkillMap(source);
    await putDoc(`progress/${source.id}/author`, { proven: { sql: "attempt" } });

    const copy = await copySkillMap(source.id, "learner");

    expect(await listDocs(`progress/${copy.id}/`)).toEqual([]);
    await deleteDoc(`progress/${source.id}/author`);
  });

  it("throws a readable 404 for a map that does not exist", async () => {
    const error = await copySkillMap(crypto.randomUUID(), "learner").catch((caught) => caught);

    expect(error).toBeInstanceOf(SkillMapError);
    expect(error.status).toBe(404);
  });
});

describe("listMapsByOwner", () => {
  it("returns only that owner's maps, newest first", async () => {
    const owner = crypto.randomUUID();
    const older = makeMap({ ownerId: owner, createdAt: "2026-11-01T00:00:00.000Z" });
    const newer = makeMap({ ownerId: owner, createdAt: "2026-11-05T00:00:00.000Z" });
    await saveSkillMap(older);
    await saveSkillMap(newer);
    await saveSkillMap(makeMap({ ownerId: "someone-else" }));

    const maps = await listMapsByOwner(owner);

    expect(maps.map((map) => map.id)).toEqual([newer.id, older.id]);
  });

  it("returns an empty list for someone with no maps", async () => {
    expect(await listMapsByOwner(crypto.randomUUID())).toEqual([]);
  });

  it("finds maps saved before the owner index existed, and marks the catch-up done", async () => {
    const owner = crypto.randomUUID();
    const old = makeMap({ ownerId: owner });
    await deleteDoc(OWNER_INDEX_READY_KEY);
    await putDoc(`maps/${old.id}`, old); // written the old way, with no index entry

    expect((await listMapsByOwner(owner)).map((map) => map.id)).toEqual([old.id]);
    expect(await getDoc(OWNER_INDEX_READY_KEY)).not.toBeNull();
  });

  it("never reads another owner's maps once the index is ready", async () => {
    const owner = crypto.randomUUID();
    const mine = makeMap({ ownerId: owner });
    await saveSkillMap(mine);
    await listMapsByOwner(owner); // the catch-up, if it has not run yet

    const theirs = makeMap({ ownerId: crypto.randomUUID() });
    await saveSkillMap(theirs);
    // Reading this document would throw, so the list proves it was never read.
    rawStore().set(`maps/${theirs.id}`, "{ not json");

    expect((await listMapsByOwner(owner)).map((map) => map.id)).toEqual([mine.id]);
  });

  it("removes an entry whose map is gone, and skips one whose map names someone else", async () => {
    const owner = crypto.randomUUID();
    const gone = makeMap({ ownerId: owner });
    await saveSkillMap(gone);
    await listMapsByOwner(owner);
    await deleteDoc(`maps/${gone.id}`);

    const someoneElses = makeMap({ ownerId: crypto.randomUUID() });
    await saveSkillMap(someoneElses);
    await putDoc(`maps-by-owner/${owner}/${someoneElses.id}`, { mapId: someoneElses.id });

    expect(await listMapsByOwner(owner)).toEqual([]);
    expect(await getDoc(`maps-by-owner/${owner}/${gone.id}`)).toBeNull();
  });

  it("forgets a map deleted with deleteSkillMap", async () => {
    const owner = crypto.randomUUID();
    const map = makeMap({ ownerId: owner });
    await saveSkillMap(map);

    await deleteSkillMap(map.id);

    expect(await getDoc(`maps-by-owner/${owner}/${map.id}`)).toBeNull();
    expect(await listMapsByOwner(owner)).toEqual([]);
  });

  it("answers an owner id that cannot be a key with no maps", async () => {
    expect(await listMapsByOwner("../maps")).toEqual([]);
  });
});

const OWNER_INDEX_READY_KEY = "indexes/maps-by-owner-v1";

/** The memory driver's own Map, to plant a document that cannot be parsed. */
function rawStore(): Map<string, string> {
  return (globalThis as typeof globalThis & { pfMemoryStore: Map<string, string> }).pfMemoryStore;
}

describe("toPublicMap", () => {
  it("never includes ownerId", async () => {
    const stored = makeMap({ ownerId: "secret-owner", forkedFrom: "source" });
    await putDoc(`maps/${stored.id}`, stored);

    const view = toPublicMap((await getDoc<SkillMap>(`maps/${stored.id}`))!);

    expect(view).not.toHaveProperty("ownerId");
    expect(JSON.stringify(view)).not.toContain("secret-owner");
  });
});
