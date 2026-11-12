import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getProgramView, startUnit } from "@/features/programs";
import { publishProof } from "@/features/proof";
import { getSkillMap } from "@/features/skill-map";
import { getProgressView, getUnitTests, listProvedNodes, startFinalInterview } from "@/features/teachback";
import { deleteUserData } from "@/features/trust";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import { PRETEST_PROOF_LABEL } from "@/shared/types";
import { dismissPretest, getPretestView, startPretest, stopPretest, submitPretestAnswers, type PretestOptions } from "./index";
import { questionsReplySchema } from "./prompt";
import type { PretestRecord } from "./types";
import { answersFor, fakeChat, KEY_MARK, mcQuestion, nodesOf, oldShapeSet, seedCourse, seedMap, seedPostingMap, seedSets } from "./test-fixtures";

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

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChat.mockReset();
  mockChat.mockImplementation(async (options) => fakeChat(options) as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("question sets", () => {
  it("are written once per unit and shared by two learners of one course, each with their own option order", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    const other = await seedMap(courseId, randomUUID(), syllabus);

    const first = collector();
    expect((await startPretest(map.id, map.ownerId, first)).state).toBe("writing");
    await first.settle();
    const second = collector();
    await startPretest(other.id, other.ownerId, second);
    await second.settle();

    // Unit 1 and the unit ahead (u2), one write-profile call each, and nothing more for the second learner.
    const written = callsLabelled("pretest-questions");
    expect(written.map(([options]) => /Unit (\d+):/.exec(options.prompt)?.[1]).sort()).toEqual(["1", "2"]);
    expect(written.every(([options]) => options.profile === "write")).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(2);

    const mine = await getPretestView(map.id, map.ownerId);
    const theirs = await getPretestView(other.id, other.ownerId);
    expect(mine.state).toBe("answering");
    expect(mine.current?.unitId).toBe("u1");
    expect(mine.current?.questions.map((question) => question.topicId)).toEqual(["u1-t1", "u1-t2", "u1-t3", "u1-t4"]);
    // Same questions, same four options each, but not the same order for both learners.
    const sorted = (view: typeof mine) => view.current?.questions.map((question) => [question.question, [...question.options].sort()]);
    expect(sorted(mine)).toEqual(sorted(theirs));
    expect(mine.current?.questions.map((question) => question.options)).not.toEqual(theirs.current?.questions.map((question) => question.options));
    // The set is keyed by course, not learner.
    expect(await listKeys(`pretest-sets/${courseId}/`)).toEqual(expect.arrayContaining([`pretest-sets/${courseId}/u1`, `pretest-sets/${courseId}/u2`]));
  });

  it("show a learner the same option order after a reload", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    const a = await getPretestView(map.id, map.ownerId);
    const b = await getPretestView(map.id, map.ownerId);
    const c = await startPretest(map.id, map.ownerId, collector());
    expect(b.current).toEqual(a.current);
    expect(c.current).toEqual(a.current);
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
    expect(options.system).toMatch(/multiple-choice/);
  });

  it("treat an old short-answer set as missing and write a new one", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await putDoc(`pretest-sets/${courseId}/u1`, oldShapeSet(courseId, syllabus.units[0]));

    const background = collector();
    expect((await startPretest(map.id, map.ownerId, background)).state).not.toBe("answering");
    // Reading the old set did not crash and did not show it.
    expect(JSON.stringify(await getPretestView(map.id, map.ownerId))).not.toContain(KEY_MARK);
    await background.settle();

    expect(callsLabelled("pretest-questions").length).toBeGreaterThanOrEqual(1);
    const stored = await getDoc<{ questions: { options?: string[]; keyPoints?: string[] }[] }>(`pretest-sets/${courseId}/u1`);
    expect(stored?.questions.every((question) => question.options?.length === 4 && question.keyPoints === undefined)).toBe(true);
    const view = await getPretestView(map.id, map.ownerId);
    expect(view.state).toBe("answering");
    expect(view.current?.questions[0].options).toHaveLength(4);
  });

  it("must have four distinct options and an explanation that names no position", () => {
    const schema = questionsReplySchema(["t1"]);
    const good = mcQuestion("t1");
    expect(schema.safeParse({ questions: [good] }).success).toBe(true);
    expect(schema.safeParse({ questions: [{ ...good, options: good.options.slice(0, 3) }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [{ ...good, options: [good.options[0], good.options[0], good.options[2], good.options[3]] }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [{ ...good, options: [good.options[0], good.options[1], good.options[2], "None of the above"] }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [{ ...good, explanation: "Option A is right." }] }).success).toBe(false);
    expect(schema.safeParse({ questions: [{ ...good, topicId: "other" }] }).success).toBe(false);
  });
});

describe("answer keys", () => {
  it("never appear in any reply before the unit is submitted, including errors", async () => {
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
    await record(getPretestView(map.id, map.ownerId));

    expect(replies).toHaveLength(4);
    const text = JSON.stringify(replies);
    expect(text).not.toContain(KEY_MARK);
    expect(text).not.toMatch(/correctIndex|explanation|keyPoints/);
    // Each question is only its text and its four options.
    const view = replies[1] as Awaited<ReturnType<typeof getPretestView>>;
    expect(view.current?.questions.every((question) => Object.keys(question).sort().join() === "options,question,topicId,topicTitle")).toBe(true);
  });

  it("are revealed for the submitted unit only, and the next unit stays closed", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());

    const view = await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, "u1", { "u1-t1": "right", "u1-t2": "wrong", "u1-t3": "dk" }), collector());

    const reply = JSON.stringify(view);
    expect(reply).toContain(`${KEY_MARK} u1-t1`);
    expect(reply).not.toContain(`${KEY_MARK} u2`);
    expect(JSON.stringify(view.current)).not.toMatch(/correctIndex|explanation|ANSWERKEY/);
    expect(view.current?.unitId).toBe("u2");
    // The review comes back on later reads too.
    const again = await getPretestView(map.id, map.ownerId);
    expect(again.results[0].review?.explanation).toContain(KEY_MARK);
  });
});

describe("grading", () => {
  it("is done in code: no model call, a review per question, and null never passes", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    mockChat.mockClear();

    const request = await answersFor(map, "u1", { "u1-t1": "right", "u1-t2": "wrong", "u1-t3": "dk" });
    // u1-t4 is left out: unanswered.
    const view = await submitPretestAnswers(map.id, map.ownerId, request, collector());

    expect(mockChat).not.toHaveBeenCalled();
    expect(view.results.map((result) => [result.topicId, result.outcome])).toEqual([
      ["u1-t1", "known"],
      ["u1-t2", "missed"],
      ["u1-t3", "skipped"],
      ["u1-t4", "skipped"],
    ]);
    expect(view.knownTopicIds).toEqual(["u1-t1"]);
    const [right, wrong, dontKnow, left] = view.results.map((result) => result.review);
    // The right pick shows the right option; the wrong pick shows both; "I don't know" shows no choice.
    expect(right?.options[right.chosen as number]).toBe("Right: u1-t1");
    expect(right?.chosen).toBe(right?.correctIndex);
    expect(wrong?.options[wrong.correctIndex]).toBe("Right: u1-t2");
    expect(wrong?.chosen).not.toBe(wrong?.correctIndex);
    expect(wrong?.explanation).toContain(KEY_MARK);
    expect(dontKnow?.chosen).toBeNull();
    expect(left?.chosen).toBeNull();
  });

  it("ends the test on a unit where nothing was right", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());

    const view = await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, "u1", { "u1-t1": "dk", "u1-t2": "wrong" }));

    expect(view.state).toBe("ended");
    expect(view.offer).toBe("taken");
    expect(view.ended).toMatchObject({ reason: "unit-missed", unitId: "u1" });
    expect(view.knownTopicIds).toEqual([]);
  });

  it("refuses a unit that is sent twice, and a choice or topic repeated within one", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    const request = await answersFor(map, "u1", { "u1-t1": "right" });

    const view = await submitPretestAnswers(map.id, map.ownerId, request, collector());
    expect(view.unitsDone).toBe(1);
    await expect(submitPretestAnswers(map.id, map.ownerId, request, collector())).rejects.toMatchObject({ status: 409 });
    expect((await getPretestView(map.id, map.ownerId)).unitsDone).toBe(1);

    const twice = { unitId: "u2", answers: [{ topicId: "u2-t1", choice: 0 }, { topicId: "u2-t1", choice: 1 }] };
    await expect(submitPretestAnswers(map.id, map.ownerId, twice, collector())).rejects.toMatchObject({ status: 400 });
  });

  it("works for a record made before option orders were seeded", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    const key = `pretest/${courseId}/${map.ownerId}`;
    const stored = (await getDoc<PretestRecord>(key)) as PretestRecord;
    delete stored.seed;
    await putDoc(key, stored);

    const before = await getPretestView(map.id, map.ownerId);
    expect(before.current?.questions[0].options).toHaveLength(4);
    const view = await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, "u1", { "u1-t1": "right" }), collector());
    expect(view.knownTopicIds).toEqual(["u1-t1"]);
  });

  it("still shows a graded unit saved with outcomes only (written before multiple choice)", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    const key = `pretest/${courseId}/${map.ownerId}`;
    const stored = (await getDoc<PretestRecord>(key)) as PretestRecord;
    await putDoc(key, {
      ...stored,
      unitIndex: 1,
      graded: [{ unitId: "u1", gradedAt: new Date().toISOString(), results: [{ topicId: "u1-t1", outcome: "known" }, { topicId: "u1-t2", outcome: "missed" }] }],
    });

    const view = await getPretestView(map.id, map.ownerId);
    expect(view.results).toEqual([
      { unitId: "u1", topicId: "u1-t1", topicTitle: "Topic 1.1", outcome: "known" },
      { unitId: "u1", topicId: "u1-t2", topicTitle: "Topic 1.2", outcome: "missed" },
    ]);
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
    await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, "u1", { "u1-t1": "right", "u1-t2": "right", "u1-t3": "right", "u1-t4": "right" }));
    // Unit 2 is not built yet: its passes are recorded against the topic ids.
    const view = await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, "u2", { "u2-t1": "right", "u2-t2": "wrong" }));
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
    await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, "u1", { "u1-t1": "right" }));

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
    await expect(submitPretestAnswers(map.id, map.ownerId, { unitId: "u1", answers: [{ topicId: "u1-t1", choice: 0 }] })).rejects.toMatchObject({ status: 409 });
    // A second map of the same course does not reset it.
    const again = await seedMap(courseId, map.ownerId, syllabus);
    await expect(startPretest(again.id, map.ownerId, collector())).rejects.toMatchObject({ status: 409 });
    expect((await getPretestView(again.id, map.ownerId)).offer).toBe("taken");
  });

  it("stops after grading what was answered on the current unit", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    const request = { ...(await answersFor(map, "u1", { "u1-t1": "right" })), stop: true };
    const view = await submitPretestAnswers(map.id, map.ownerId, request, collector());
    expect(view).toMatchObject({ state: "ended", ended: { reason: "stopped" }, knownTopicIds: ["u1-t1"] });
  });

  it("ends as completed after the last unit", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await startPretest(map.id, map.ownerId, collector());
    for (const unit of syllabus.units) {
      await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, unit.id, { [unit.topics[0].id]: "right" }));
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
    await submitPretestAnswers(map.id, map.ownerId, await answersFor(map, "u1", { "u1-t1": "right" }));
    expect(await getDoc(`pretest/${courseId}/${map.ownerId}`)).not.toBeNull();

    const counts = await deleteUserData(map.ownerId);

    expect(counts.pretests).toBe(1);
    expect((await listKeys("pretest/")).filter((key) => key.includes(map.ownerId))).toEqual([]);
    expect((await listKeys(`progress/${map.id}/`))).toEqual([]);
    expect(await getDoc(`pretest-sets/${courseId}/u1`)).not.toBeNull();
  });
});
