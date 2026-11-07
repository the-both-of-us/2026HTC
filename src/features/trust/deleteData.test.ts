import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { isPublished, publishCourse } from "@/features/courses";
import { getProof, publishProof } from "@/features/proof";
import { getSkillMap } from "@/features/skill-map";
import { getAttempt, getProgress } from "@/features/teachback";
import { getDoc, putDoc } from "@/shared/store";
import type { Attempt, SkillMap } from "@/shared/types";
import { deleteUserData, NOTHING_DELETED } from "./deleteData";

const EXPLANATION =
  "An inner join keeps only rows that match in both tables, while a left join keeps every left row and fills the rest with NULL.";

/** One learner's work: a map with one proven skill, its attempt, an evidence page and a course. */
async function seedLearner() {
  const userId = randomUUID();
  const map: SkillMap = {
    id: randomUUID(),
    ownerId: userId,
    title: "Data Analyst",
    subtitle: "Calgary, AB",
    sourceKind: "posting",
    sourceText: "Strong SQL required.",
    nodes: [
      {
        id: "joins",
        title: "SQL joins",
        why: "Needed for the job.",
        prerequisites: [],
        fromSource: true,
        citation: { kind: "posting", quote: "Strong SQL required", verified: true },
        checkpoints: ["Inner join keeps only matches", "Left join keeps every left row"],
      },
    ],
    createdAt: "2026-11-07T10:00:00.000Z",
  };
  const attempt: Attempt = {
    id: randomUUID(),
    mapId: map.id,
    nodeId: "joins",
    ownerId: userId,
    explanation: EXPLANATION,
    integrity: { pasted: false, activeMs: 42_000, wordCount: 24, inputMethod: "typed" },
    grade: {
      score: 100,
      checkpoints: [
        { checkpoint: "Inner join keeps only matches", quote: "keeps only rows that match in both tables", met: true },
        { checkpoint: "Left join keeps every left row", quote: "keeps every left row", met: true },
      ],
      misconceptions: [],
      rejectedQuotes: 0,
    },
    followUp: { question: "What happens to a row with no match?", answer: "It gets NULLs.", passed: true, feedback: "Right." },
    status: "proven",
    createdAt: "2026-11-07T11:00:00.000Z",
  };

  await putDoc(`maps/${map.id}`, map);
  await putDoc(`attempts/${attempt.id}`, attempt);
  await putDoc(`attempts/${attempt.id}/claim`, { claimedAt: "2026-11-07T11:00:00.000Z" });
  await putDoc(`progress/${map.id}/${userId}/joins`, { nodeId: "joins", attemptId: attempt.id, provenAt: "2026-11-07T11:00:00.000Z" });
  await putDoc(`grid-solves/${userId}/reserve-margin`, { exerciseId: "reserve-margin", solvedAt: "2026-11-07T12:00:00.000Z" });
  const proof = await publishProof(userId, map.id, "Maya Chen");
  await publishCourse(map.id, userId, "Maya");
  return { userId, map, attempt, proofId: proof.id };
}

describe("deleteUserData", () => {
  let me: Awaited<ReturnType<typeof seedLearner>>;
  let someoneElse: Awaited<ReturnType<typeof seedLearner>>;

  beforeEach(async () => {
    me = await seedLearner();
    someoneElse = await seedLearner();
  });

  it("removes the user's maps, attempts, claims, progress, evidence pages, course listings and grid answers", async () => {
    const counts = await deleteUserData(me.userId);

    expect(counts).toEqual({ maps: 1, attempts: 1, provenSkills: 1, evidencePages: 1, courses: 1, gridAnswers: 1 });
    expect(await getSkillMap(me.map.id)).toBeNull();
    expect(await getAttempt(me.attempt.id)).toBeNull();
    expect(await getDoc(`attempts/${me.attempt.id}/claim`)).toBeNull();
    expect(await getProgress(me.map.id, me.userId)).toBeNull();
    expect(await getProof(me.proofId)).toBeNull();
    expect(await getDoc(`proof-index/${me.map.id}`)).toBeNull();
    expect(await isPublished(me.map.id)).toBe(false);
    expect(await getDoc(`grid-solves/${me.userId}/reserve-margin`)).toBeNull();
  });

  it("leaves another user's work exactly as it was", async () => {
    const before = {
      map: await getSkillMap(someoneElse.map.id),
      attempt: await getAttempt(someoneElse.attempt.id),
      progress: await getProgress(someoneElse.map.id, someoneElse.userId),
      proof: await getProof(someoneElse.proofId),
    };

    await deleteUserData(me.userId);

    expect(await getSkillMap(someoneElse.map.id)).toEqual(before.map);
    expect(await getAttempt(someoneElse.attempt.id)).toEqual(before.attempt);
    expect(await getDoc(`attempts/${someoneElse.attempt.id}/claim`)).not.toBeNull();
    expect(await getProgress(someoneElse.map.id, someoneElse.userId)).toEqual(before.progress);
    expect(await getProof(someoneElse.proofId)).toEqual(before.proof);
    expect(before.proof?.state).toBe("live");
    expect(await isPublished(someoneElse.map.id)).toBe(true);
    expect(await getDoc(`grid-solves/${someoneElse.userId}/reserve-margin`)).not.toBeNull();
  });

  it("is safe to run again, and for someone with nothing saved", async () => {
    await deleteUserData(me.userId);
    expect(await deleteUserData(me.userId)).toEqual(NOTHING_DELETED);
    expect(await deleteUserData(randomUUID())).toEqual(NOTHING_DELETED);
  });
});
