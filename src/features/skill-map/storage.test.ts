import { describe, expect, it } from "vitest";
import { deleteDoc, getDoc, listDocs, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { SkillMapError } from "./build";
import { copySkillMap, getSkillMap, listMapsByOwner, saveSkillMap, toPublicMap } from "./storage";

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
});

describe("toPublicMap", () => {
  it("never includes ownerId", async () => {
    const stored = makeMap({ ownerId: "secret-owner", forkedFrom: "source" });
    await putDoc(`maps/${stored.id}`, stored);

    const view = toPublicMap((await getDoc<SkillMap>(`maps/${stored.id}`))!);

    expect(view).not.toHaveProperty("ownerId");
    expect(JSON.stringify(view)).not.toContain("secret-owner");
  });
});
