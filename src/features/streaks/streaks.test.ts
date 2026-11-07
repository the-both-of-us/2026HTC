import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { gradeFollowUp } from "@/features/teachback";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { answerRelight, getMapHabits, getStreak, recordProved, startRelight } from "./streaks";

// No real AI in tests: the relight check's grader is a mock.
vi.mock("@/features/teachback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/teachback")>()),
  gradeFollowUp: vi.fn(),
}));
const mockGrade = vi.mocked(gradeFollowUp);

async function seedMap(ownerId: string): Promise<SkillMap> {
  const node = (id: string, prerequisites: string[] = []) => ({
    id,
    title: id.toUpperCase(),
    why: "Useful.",
    prerequisites,
    fromSource: false,
    citation: null,
    checkpoints: ["secret"],
  });
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    title: "Tides",
    subtitle: "",
    sourceKind: "topic",
    sourceText: "tides",
    nodes: [node("moon"), node("sun"), node("spring", ["moon", "sun"])],
    createdAt: "2026-11-01T10:00:00.000Z",
  };
  await putDoc(`maps/${map.id}`, map);
  return map;
}

/** A proved topic, as teachback stores it: the attempt plus the progress record. */
async function seedProof(map: SkillMap, ownerId: string, nodeId: string, createdAt: string) {
  const attemptId = randomUUID();
  await putDoc(`attempts/${attemptId}`, {
    id: attemptId,
    mapId: map.id,
    nodeId,
    ownerId,
    explanation: "The moon pulls the water.",
    followUp: { question: "Why two tides a day?", answer: "", passed: true, feedback: "" },
    status: "proven",
    createdAt,
  });
  await putDoc(`progress/${map.id}/${ownerId}/${nodeId}`, { nodeId, attemptId, provenAt: createdAt });
  return attemptId;
}

describe("streaks with the store", () => {
  it("counts a proof once, and doubles the topic of the day", async () => {
    const user = randomUUID();
    const map = await seedMap(user);
    const now = new Date("2026-11-07T18:00:00Z");

    const habits = await getMapHabits(user, map.id, now);
    expect(["moon", "sun"]).toContain(habits.topicOfTheDay);

    await recordProved(user, { mapId: map.id, nodeId: habits.topicOfTheDay!, attemptId: "one" }, now);
    await recordProved(user, { mapId: map.id, nodeId: habits.topicOfTheDay!, attemptId: "one" }, now);
    expect(await getStreak(user, now)).toMatchObject({ count: 1, doneToday: true, sparksThisWeek: 2 });
  });

  it("dims an old proof, and a passed quick check relights it without touching the proof", async () => {
    const user = randomUUID();
    const map = await seedMap(user);
    await seedProof(map, user, "moon", "2026-11-01T18:00:00Z");
    const now = new Date("2026-11-09T18:00:00Z"); // 8 days later

    expect((await getMapHabits(user, map.id, now)).dim).toEqual({ moon: 2 });
    expect(await startRelight(user, map.id, "moon", now)).toEqual({ question: "Why two tides a day?" });

    mockGrade.mockResolvedValueOnce({ passed: false, feedback: "Not yet." });
    expect((await answerRelight(user, map.id, "moon", "no idea", now)).passed).toBe(false);
    expect((await getMapHabits(user, map.id, now)).dim).toEqual({ moon: 2 });

    mockGrade.mockResolvedValueOnce({ passed: true, feedback: "Yes." });
    const relit = await answerRelight(user, map.id, "moon", "Two bulges of water.", now);
    expect(relit).toMatchObject({ passed: true, streak: { count: 1, doneToday: true } });
    expect((await getMapHabits(user, map.id, now)).dim).toEqual({ moon: 0 });
  });

  it("won't relight a topic that is still lit, or someone else's map", async () => {
    const user = randomUUID();
    const map = await seedMap(user);
    await seedProof(map, user, "moon", "2026-11-07T18:00:00Z");
    const now = new Date("2026-11-08T18:00:00Z");

    await expect(startRelight(user, map.id, "moon", now)).rejects.toMatchObject({ status: 409 });
    await expect(startRelight(randomUUID(), map.id, "moon", now)).rejects.toMatchObject({ status: 404 });
    await expect(getMapHabits(randomUUID(), map.id, now)).rejects.toMatchObject({ status: 404 });
  });
});
