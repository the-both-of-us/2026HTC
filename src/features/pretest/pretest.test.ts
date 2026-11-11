import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, chatJSON } from "@/features/ai";
import { getProgramView, startUnit } from "@/features/programs";
import { publishProof } from "@/features/proof";
import { getSkillMap } from "@/features/skill-map";
import { getProgressView, getUnitTests, listProvedNodes, startFinalInterview } from "@/features/teachback";
import { deleteUserData } from "@/features/trust";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import { PRETEST_PROOF_LABEL } from "@/shared/types";
import { dismissPretest, getPretestView, startPretest, stopPretest, submitPretestAnswers, type PretestOptions } from "./index";
import { fakeChat, KEY_MARK, nodesOf, seedCourse, seedMap, seedPostingMap, seedSets } from "./test-fixtures";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));
const mockChat = vi.mocked(chatJSON);

/** Collects the background work a call starts, so a test can wait for it. */
function collector(): PretestOptions & { settle: () => Promise<void> } {
  // Like after(): nothing runs until the reply is made.
  const tasks: (() => Promise<unknown>)[] = [];
  return {
    background: (_label, task) => {
      tasks.push(task);
    },
    deadline: Date.now() + 112_000,
    settle: async () => {
      await Promise.all(tasks.splice(0).map((task) => task()));
    },
  };
}

const callsLabelled = (label: string) => mockChat.mock.calls.filter(([options]) => options.label === label);

const right = (topicId: string) => ({ topicId, answer: `RIGHT: ${topicId} works like this, with an example.` });
const wrong = (topicId: string) => ({ topicId, answer: `Something unrelated about ${topicId}.` });

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChat.mockReset();
  mockChat.mockImplementation(async (options) => fakeChat(options) as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("question sets", () => {
  it("are written once per unit and shared by two learners of one course", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    const other = await seedMap(courseId, randomUUID(), syllabus);

    const first = collector();
    expect((await startPretest(map.id, map.ownerId, first)).state).toBe("writing");
    await first.settle();
    const second = collector();
    const view = await startPretest(other.id, other.ownerId, second);
    await second.settle();

    // Unit 1 and the unit ahead (u2), one call each, and nothing more for the second learner.
    const written = callsLabelled("pretest-questions").map(([options]) => /Unit (\d+):/.exec(options.prompt)?.[1]);
    expect(written.sort()).toEqual(["1", "2"]);
    expect(view.state).toBe("answering");
    expect(view.current?.unitId).toBe("u1");
    expect(view.current?.questions.map((question) => question.topicId)).toEqual(["u1-t1", "u1-t2", "u1-t3", "u1-t4"]);
    // The set is keyed by course, not learner.
    expect(await listKeys(`pretest-sets/${courseId}/`)).toEqual(expect.arrayContaining([`pretest-sets/${courseId}/u1`, `pretest-sets/${courseId}/u2`]));
  });

  it("are written from the syllabus only, with no learner data", async () => {
    const { map } = await seedCourse();
    const background = collector();
    await startPretest(map.id, map.ownerId, background);
    await background.settle();
    const [options] = callsLabelled("pretest-questions")[0];
    expect(options.prompt).toContain("Topic 1.1");
    expect(options.prompt).not.toContain(map.ownerId);
    expect(options.prompt).not.toContain(map.id);
    expect(options.profile).toBe("write");
  });
});

describe("answer keys", () => {
  it("never appear in any reply, including errors", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    const replies: unknown[] = [];
    const record = async (work: Promise<unknown>) => {
      try {
        replies.push(await work);
      } catch (error) {
        replies.push(error instanceof Error ? error.message : error);
      }
    };

    await record(getPretestView(map.id, map.ownerId));
    await record(startPretest(map.id, map.ownerId, collector()));
    await record(submitPretestAnswers(map.id, map.ownerId, { unitId: "u2", answers: [] }));
    mockChat.mockRejectedValueOnce(new AiUnavailableError());
    await record(submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [right("u1-t1")] }));
    await record(submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [right("u1-t1"), wrong("u1-t2")] }));
    await record(getPretestView(map.id, map.ownerId));

    expect(replies).toHaveLength(6);
    expect(JSON.stringify(replies)).not.toContain(KEY_MARK);
  });
});

describe("grading", () => {
  it("never sends empty or \"I don't know\" answers to the model, and never passes them", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());

    const view = await submitPretestAnswers(map.id, map.ownerId, {
      unitId: "u1",
      answers: [
        { topicId: "u1-t1", answer: "RIGHT but I ticked it", dontKnow: true },
        { topicId: "u1-t2", answer: "   " },
        { topicId: "u1-t3", answer: "I don't know" },
        right("u1-t4"),
      ],
    });

    const grades = callsLabelled("pretest-grade");
    expect(grades).toHaveLength(1);
    expect(grades[0][0].profile).toBe("check");
    expect(grades[0][0].prompt).toContain("u1-t4");
    expect(grades[0][0].prompt).not.toMatch(/u1-t1|u1-t2|u1-t3|ticked|don't know/);
    expect(view.results.map((result) => [result.topicId, result.outcome])).toEqual([
      ["u1-t1", "skipped"],
      ["u1-t2", "skipped"],
      ["u1-t3", "skipped"],
      ["u1-t4", "known"],
    ]);
    expect(view.knownTopicIds).toEqual(["u1-t4"]);
  });

  it("makes no call when every answer is skipped, and ends the test on that unit", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());

    const view = await submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [{ topicId: "u1-t1", answer: "idk" }] });

    expect(callsLabelled("pretest-grade")).toHaveLength(0);
    expect(view.state).toBe("ended");
    expect(view.offer).toBe("taken");
    expect(view.ended).toMatchObject({ reason: "unit-missed", unitId: "u1" });
    expect(view.knownTopicIds).toEqual([]);
  });

  it("lets code decide: a missing or contradictory verdict is a miss", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    mockChat.mockResolvedValueOnce({ verdicts: [{ item: 1, correct: true }, { item: 2, correct: true }, { item: 2, correct: false }, { item: 9, correct: true }] } as never);

    const view = await submitPretestAnswers(map.id, map.ownerId, {
      unitId: "u1",
      answers: [right("u1-t1"), right("u1-t2"), right("u1-t3")],
    });
    expect(view.results.map((result) => result.outcome)).toEqual(["known", "missed", "missed", "skipped"]);
  });

  it("records nothing when the check fails, so the same answers can be sent again", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    mockChat.mockRejectedValueOnce(new AiUnavailableError());

    await expect(submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [right("u1-t1")] })).rejects.toThrow(AiUnavailableError);
    expect((await getPretestView(map.id, map.ownerId)).unitsDone).toBe(0);
    const view = await submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [right("u1-t1")] });
    expect(view.unitsDone).toBe(1);
    expect(view.current?.unitId).toBe("u2");
  });
});

describe("a pre-test pass", () => {
  it("counts for node state, unit unlock and course unlock, but unit tests and the final are still required", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    // The canonical units 2 and 3 already exist, so building them for this learner makes no call.
    for (const unitId of ["u2", "u3"]) {
      await putDoc(`unit-nodes/${courseId}/${unitId}`, { contentId: courseId, unitId, nodes: nodesOf(syllabus, unitId), builtAt: new Date().toISOString() });
    }
    const programId = randomUUID();
    await putDoc(`programs/${programId}`, {
      id: programId,
      ownerId: map.ownerId,
      title: "Software",
      summary: "Build software.",
      sourceKind: "topic",
      sourceText: "Software",
      depth: "degree",
      createdAt: new Date().toISOString(),
      courses: [
        { slug: "system-design", title: "System design", summary: "Design.", requires: [], mapId: map.id, courseId },
        { slug: "distributed", title: "Distributed systems", summary: "Scale.", requires: ["system-design"] },
      ],
    });
    // Before: unit 2 is closed and the next course is locked.
    await expect(startUnit(map.id, "u2", map.ownerId)).rejects.toMatchObject({ status: 409 });
    expect((await getProgramView(programId, map.ownerId))?.courses[1].state).toBe("locked");

    await startPretest(map.id, map.ownerId, collector());
    await submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: ["u1-t1", "u1-t2", "u1-t3", "u1-t4"].map(right) });
    // Unit 2 is not built yet: its passes are recorded against the topic ids.
    const view = await submitPretestAnswers(map.id, map.ownerId, { unitId: "u2", answers: [right("u2-t1"), wrong("u2-t2")] });
    expect(view.knownTopicIds.sort()).toEqual(["u1-t1", "u1-t2", "u1-t3", "u1-t4", "u2-t1"]);

    // Node state: proven, and labelled as a pre-test pass.
    const progress = await getProgressView(map.ownerId, map.id);
    expect(progress.states["u1-t1"]).toBe("proven");
    expect(progress.proven["u1-t1"]).toBe("pretest");
    expect(progress.knownByPretest).toContain("u2-t1");
    expect(progress.states["u2-t1"]).toBeUndefined();

    // Course unlock: 5 of 12 planned topics proved, a quarter needed, including the unbuilt unit's pass.
    const program = await getProgramView(programId, map.ownerId);
    expect(program?.courses[0].proven).toBe(5);
    expect(program?.courses[1].state).toBe("open");
    expect(program?.courses[0].state).toBe("open");

    // Unit unlock: unit 2 opens; once built, its pre-test pass shows as known.
    expect(await startUnit(map.id, "u2", map.ownerId)).toMatchObject({ status: "ready" });
    const built = await getProgressView(map.ownerId, map.id);
    expect(built.states["u2-t1"]).toBe("proven");
    expect(built.proven["u2-t1"]).toBe("pretest");
    expect((await getSkillMap(map.id))?.nodes.some((node) => node.id === "u2-t1")).toBe(true);

    // Unit 1's test still has to be passed, and the course final stays closed.
    const tests = await getUnitTests(map.ownerId, map.id);
    expect(tests.find((test) => test.unitId === "u1")?.test.state).not.toBe("passed");
    await expect(startFinalInterview(map.ownerId, map.id)).rejects.toMatchObject({ status: 403 });
  });

  it("is labelled as a pre-test pass on the evidence page and in proof lists, with no transcript", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    await submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [right("u1-t1")] });

    const proof = await publishProof(map.ownerId, map.id, "Sam");
    expect(proof.snapshot.skills).toEqual([]);
    expect(proof.snapshot.knownByPretest).toEqual([{ nodeId: "u1-t1", title: "Topic 1.1", label: PRETEST_PROOF_LABEL, passedAt: expect.any(String) }]);
    expect(proof.snapshot.notYetProven).not.toContain("Topic 1.1");
    expect(await listProvedNodes(map.id, map.ownerId)).toEqual([{ nodeId: "u1-t1", provenAt: expect.any(String), pretest: true }]);
    expect(await listKeys("attempts/")).toEqual([]);
  });
});

describe("the offer", () => {
  it("is suggested on first open, stays available after Not now, and is refused a second time", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    expect(await getPretestView(map.id, map.ownerId)).toMatchObject({ offer: "suggest", state: "not-started" });
    expect(await dismissPretest(map.id, map.ownerId)).toMatchObject({ offer: "available", dismissed: true });

    await startPretest(map.id, map.ownerId, collector());
    const stopped = await stopPretest(map.id, map.ownerId);
    expect(stopped).toMatchObject({ offer: "taken", state: "ended", ended: { reason: "stopped" } });

    await expect(startPretest(map.id, map.ownerId, collector())).rejects.toMatchObject({ status: 409 });
    await expect(submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [right("u1-t1")] })).rejects.toMatchObject({ status: 409 });
    // A second map of the same course does not reset it.
    const again = await seedMap(courseId, map.ownerId, syllabus);
    await expect(startPretest(again.id, map.ownerId, collector())).rejects.toMatchObject({ status: 409 });
    expect((await getPretestView(again.id, map.ownerId)).offer).toBe("taken");
  });

  it("ends as completed after the last unit", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    for (const unit of syllabus.units) {
      await submitPretestAnswers(map.id, map.ownerId, { unitId: unit.id, answers: [right(unit.topics[0].id)] });
    }
    const view = await getPretestView(map.id, map.ownerId);
    expect(view).toMatchObject({ offer: "taken", state: "ended", unitsDone: 3, ended: { reason: "completed" } });
  });

  it("is refused on posting and PDF maps, and hidden from strangers", async () => {
    const owner = randomUUID();
    for (const kind of ["posting", "pdf"] as const) {
      const map = await seedPostingMap(owner, kind);
      expect(await getPretestView(map.id, owner)).toMatchObject({ offer: "none", reason: "not-a-course" });
      await expect(startPretest(map.id, owner, collector())).rejects.toMatchObject({ status: 400 });
      await expect(submitPretestAnswers(map.id, owner, { unitId: "u1", answers: [] })).rejects.toMatchObject({ status: 400 });
      await expect(dismissPretest(map.id, owner)).rejects.toMatchObject({ status: 400 });
    }
    const { map } = await seedCourse();
    await expect(getPretestView(map.id, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(startPretest(map.id, null, collector())).rejects.toMatchObject({ status: 404 });
    expect(mockChat).not.toHaveBeenCalled();
  });
});

describe("Delete my data", () => {
  it("removes the learner's results and passes, and keeps the course's question sets", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    await submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [right("u1-t1")] });
    expect(await getDoc(`pretest/${courseId}/${map.ownerId}`)).not.toBeNull();

    const counts = await deleteUserData(map.ownerId);

    expect(counts.pretests).toBe(1);
    expect((await listKeys("pretest/")).filter((key) => key.includes(map.ownerId))).toEqual([]);
    expect((await listKeys(`progress/${map.id}/`))).toEqual([]);
    expect(await getDoc(`pretest-sets/${courseId}/u1`)).not.toBeNull();
  });
});
