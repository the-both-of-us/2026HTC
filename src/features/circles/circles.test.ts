import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSkillMap } from "@/features/skill-map";
import { listKeys, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { cheerProof, deleteCircleData, findCircleForMap, getCircleView, joinCircle, startCircle } from "./circles";

async function seedMap(ownerId: string): Promise<SkillMap> {
  const node = (id: string, title: string, prerequisites: string[] = []) => ({
    id,
    title,
    why: "Useful.",
    prerequisites,
    fromSource: false,
    citation: null,
    checkpoints: ["The secret checkpoint answer"],
  });
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    title: "How black holes work",
    subtitle: "",
    sourceKind: "topic",
    sourceText: "black holes",
    nodes: [node("gravity", "Gravity"), node("horizon", "Event horizon", ["gravity"])],
    createdAt: "2026-11-07T10:00:00.000Z",
  };
  await putDoc(`maps/${map.id}`, map);
  return map;
}

async function prove(mapId: string, ownerId: string, nodeId: string, provenAt: string) {
  await putDoc(`progress/${mapId}/${ownerId}/${nodeId}`, { nodeId, attemptId: randomUUID(), provenAt });
}

describe("study circles", () => {
  it("starts a circle once per map, with the owner as the first member", async () => {
    const owner = randomUUID();
    const map = await seedMap(owner);
    const first = await startCircle(owner, map.id, "  Abdu  ");
    const again = await startCircle(owner, map.id, "Abdu");

    expect(first.code).toMatch(/^[a-z2-7]{10}$/);
    expect(again.code).toBe(first.code);
    const view = await getCircleView(first.code, owner);
    expect(view.members).toEqual([{ name: "Abdu", proved: 0, isYou: true }]);
    expect(view.yourMapId).toBe(map.id);
  });

  it("refuses a map that belongs to someone else, and bad names", async () => {
    const map = await seedMap(randomUUID());
    await expect(startCircle(randomUUID(), map.id, "Sam")).rejects.toThrow("Only the person who built");
    await expect(startCircle(map.ownerId, map.id, "   ")).rejects.toThrow("between 1 and 24");
    await expect(startCircle(map.ownerId, map.id, "x".repeat(25))).rejects.toThrow("between 1 and 24");
    await expect(startCircle(map.ownerId, map.id, "\u200b\u0000")).rejects.toThrow("between 1 and 24");
  });

  it("finds a circle from a code typed in capitals, and gives an emoji name a whole initial", async () => {
    const owner = randomUUID();
    const map = await seedMap(owner);
    const { code } = await startCircle(owner, map.id, "🦊 Fox");
    await joinCircle(randomUUID(), code.toUpperCase(), "Sam");
    await prove(map.id, owner, "gravity", "2026-11-07T11:00:00.000Z");

    const view = await getCircleView(code.toUpperCase(), null);
    expect(view.code).toBe(code);
    expect(view.members).toHaveLength(2);
    expect(view.provedBy.gravity).toEqual([{ initials: "🦊F", name: "🦊 Fox" }]);
  });

  it("gives a joiner their own copy, and the same copy when they join again", async () => {
    const owner = randomUUID();
    const map = await seedMap(owner);
    const { code } = await startCircle(owner, map.id, "Abdu");
    const sam = randomUUID();

    const first = await joinCircle(sam, code, "Sam");
    const second = await joinCircle(sam, code, "Sam");
    expect(second.mapId).toBe(first.mapId);
    expect(first.mapId).not.toBe(map.id);
    expect((await getSkillMap(first.mapId))?.ownerId).toBe(sam);
    expect(await findCircleForMap(first.mapId, sam)).toEqual({ code, title: map.title });
    expect((await getCircleView(code, null)).members).toHaveLength(2);
  });

  it("refuses a code that does not exist or is not ours", async () => {
    await expect(joinCircle(randomUUID(), "aaaaaaaaaa", "Sam")).rejects.toThrow("could not find that circle");
    await expect(getCircleView("../maps/x", null)).rejects.toThrow("could not find that circle");
  });

  it("shows proofs newest first, with initials on the map", async () => {
    const owner = randomUUID();
    const map = await seedMap(owner);
    const { code } = await startCircle(owner, map.id, "Abdu Mohamed");
    const sam = randomUUID();
    const { mapId } = await joinCircle(sam, code, "Sam");
    await prove(map.id, owner, "gravity", "2026-11-07T11:00:00.000Z");
    await prove(mapId, sam, "gravity", "2026-11-07T12:00:00.000Z");
    await prove(mapId, sam, "horizon", "2026-11-07T13:00:00.000Z");

    const view = await getCircleView(code, sam);
    expect(view.feed.map((item) => `${item.name}: ${item.nodeTitle}`)).toEqual([
      "Sam: Event horizon",
      "Sam: Gravity",
      "Abdu Mohamed: Gravity",
    ]);
    expect(view.provedBy.gravity.map((avatar) => avatar.initials)).toEqual(["AM", "S"]);
    expect(view.members).toEqual([
      { name: "Abdu Mohamed", proved: 1, isYou: false },
      { name: "Sam", proved: 2, isYou: true },
    ]);
  });

  it("shows locked, open and proven by the viewer's own prerequisites", async () => {
    // A circle's read is cached for a moment, so each case gets its own circle.
    const fresh = await seedMap(randomUUID());
    const first = await startCircle(fresh.ownerId, fresh.id, "Abdu");
    const visitor = { gravity: "available", horizon: "locked" };
    expect((await getCircleView(first.code, fresh.ownerId)).states).toEqual(visitor);
    expect((await getCircleView(first.code, null)).states).toEqual(visitor);

    const owner = randomUUID();
    const map = await seedMap(owner);
    const { code } = await startCircle(owner, map.id, "Abdu");
    const sam = randomUUID();
    await joinCircle(sam, code, "Sam");
    await prove(map.id, owner, "gravity", "2026-11-07T11:00:00.000Z");
    // Proven on the shared map, but Sam hasn't proved gravity, so horizon stays locked for Sam.
    expect((await getCircleView(code, sam)).states).toEqual({ gravity: "proven", horizon: "locked" });
    expect((await getCircleView(code, owner)).states).toEqual({ gravity: "proven", horizon: "available" });
    expect((await getCircleView(code, null)).states).toEqual({ gravity: "proven", horizon: "locked" });
  });

  it("never sends a user id or the answer key", async () => {
    const owner = randomUUID();
    const map = await seedMap(owner);
    const { code } = await startCircle(owner, map.id, "Abdu");
    const sam = randomUUID();
    await joinCircle(sam, code, "Sam");
    await prove(map.id, owner, "gravity", "2026-11-07T11:00:00.000Z");

    const json = JSON.stringify(await getCircleView(code, null));
    expect(json).not.toContain(owner);
    expect(json).not.toContain(sam);
    expect(json).not.toContain(map.id);
    expect(json).not.toContain("secret checkpoint");
    expect(json).not.toContain("createdBy");
  });

  it("deletes a user's memberships and closes the circles they started", async () => {
    const owner = randomUUID();
    const map = await seedMap(owner);
    const { code } = await startCircle(owner, map.id, "Abdu");
    const sam = randomUUID();
    const { mapId } = await joinCircle(sam, code, "Sam");

    const otherOwner = randomUUID();
    const other = await startCircle(otherOwner, (await seedMap(otherOwner)).id, "Lee");
    await joinCircle(owner, other.code, "Abdu");

    expect(await deleteCircleData(owner)).toEqual({ circles: 1, memberships: 2, cheers: 0 });
    expect(await listKeys(`circles/${code}`)).toEqual([]);
    expect((await getCircleView(other.code, null)).members.map((member) => member.name)).toEqual(["Lee"]);
    expect(await getSkillMap(mapId)).not.toBeNull();
    expect(await deleteCircleData(owner)).toEqual({ circles: 0, memberships: 0, cheers: 0 });
  });

  it("counts one cheer per member, tells the prover, and refuses non-members and your own proof", async () => {
    const owner = randomUUID();
    const map = await seedMap(owner);
    const { code } = await startCircle(owner, map.id, "Abdu");
    const sam = randomUUID();
    const lee = randomUUID();
    const { mapId } = await joinCircle(sam, code, "Sam");
    await joinCircle(lee, code, "Lee");
    await prove(mapId, sam, "gravity", "2026-11-07T12:00:00.000Z");

    const item = (await getCircleView(code, lee)).feed[0];
    expect(item).toMatchObject({ name: "Sam", nodeTitle: "Gravity", isYou: false, cheers: 0, youCheered: false });
    expect(item.id).toMatch(/^[A-Za-z0-9_-]{16}$/);

    expect(await cheerProof(lee, code, item.id)).toEqual({ cheers: 1 });
    expect(await cheerProof(lee, code, item.id)).toEqual({ cheers: 1 });
    expect(await cheerProof(owner, code, item.id)).toEqual({ cheers: 2 });
    await expect(cheerProof(sam, code, item.id)).rejects.toThrow("That one is yours");
    await expect(cheerProof(randomUUID(), code, item.id)).rejects.toThrow("Join the circle");
    await expect(cheerProof(lee, code, "x".repeat(16))).rejects.toThrow("not in this circle");
    await expect(cheerProof(lee, code, "../../maps/abcd")).rejects.toThrow("not in this circle");

    const forLee = (await getCircleView(code, lee)).feed[0];
    expect(forLee).toMatchObject({ cheers: 2, youCheered: true });
    const forSam = await getCircleView(code, sam);
    expect(forSam.feed[0]).toMatchObject({ isYou: true, cheers: 2, youCheered: false });
    expect(forSam.cheersForYou.map((cheer) => `${cheer.name}: ${cheer.nodeTitle}`).sort()).toEqual([
      "Abdu: Gravity",
      "Lee: Gravity",
    ]);
    expect((await getCircleView(code, lee)).cheersForYou).toEqual([]);

    const json = JSON.stringify(forSam);
    // Sam sees his own map id (yourMapId), and no one's user id.
    for (const id of [owner, sam, lee, map.id]) expect(json).not.toContain(id);

    expect(await deleteCircleData(lee)).toEqual({ circles: 0, memberships: 1, cheers: 1 });
    expect((await getCircleView(code, sam)).feed[0].cheers).toBe(1);
  });
});
