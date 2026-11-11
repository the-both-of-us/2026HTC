import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamLines } from "@/features/ai";
import { publishCourse } from "@/features/courses";
import { unlockNode } from "@/features/teachback";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { fakeRunning } from "@/shared/store/onceFake";
import { deleteLessonsForMaps, ensureLesson, getOrCreateLesson } from "./lessons";
import { lessonLinesSystemPrompt, type RawLesson } from "./prompt";
import { lessonIn, linesOf, replyWith } from "./testing";
import { copiedCheckpoint, lessonProblem, toLesson } from "./validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
  streamLines: vi.fn(),
}));
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));
const mockStream = vi.mocked(streamLines);

const OWNER = randomUUID();
const STRANGER = randomUUID();

const NODE: SkillNode = {
  id: "sql-joins",
  title: "SQL joins",
  why: "Reports combine tables.",
  prerequisites: [],
  fromSource: true,
  citation: { kind: "posting", quote: "write SQL joins", verified: true },
  checkpoints: [
    "A LEFT JOIN keeps every row from the left table even when the right table has no match.",
    "An INNER JOIN returns only the rows that have matching keys in both tables.",
  ],
};

/** About 700 words that teach the idea without copying a checkpoint. */
function goodLesson(): RawLesson {
  const filler = "Picture two lists of names on paper, and you are drawing lines between people who appear on both of them. ";
  return {
    idea: [filler.repeat(10), filler.repeat(10)],
    example: { intro: filler.repeat(4), code: "SELECT * FROM a LEFT JOIN b ON a.id = b.id;", after: filler.repeat(3) },
    mistakes: [
      { mistake: "Joining on the wrong column.", fix: filler.repeat(2) },
      { mistake: "Forgetting unmatched rows.", fix: filler.repeat(2) },
      { mistake: "Counting duplicates twice.", fix: filler.repeat(2) },
    ],
    checks: [
      { question: "Which join keeps unmatched rows?", answer: "The left one." },
      { question: "Which join keeps only matches?", answer: "The inner one." },
    ],
  };
}

let mapId: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockStream.mockReset();
  mockStream.mockImplementation(replyWith(goodLesson()));
  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Data analyst",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "SECRET POSTING TEXT",
    nodes: [NODE],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

describe("copiedCheckpoint", () => {
  it("catches a checkpoint pasted word for word, whatever the case and punctuation", () => {
    const text = `Remember: an inner join returns ONLY the rows that have matching keys, in both tables!`;
    expect(copiedCheckpoint(text, NODE.checkpoints)).toBe(NODE.checkpoints[1]);
  });

  it("catches a run of 8 of its words in a row", () => {
    const text = "In short, it keeps every row from the left table even if nothing matches.";
    expect(copiedCheckpoint(text, NODE.checkpoints)).toBe(NODE.checkpoints[0]);
  });

  it("lets the same idea through in other words", () => {
    const text = "A left join never drops a row from the first table; missing partners just show up as empty.";
    expect(copiedCheckpoint(text, NODE.checkpoints)).toBeNull();
  });
});

describe("lessonProblem", () => {
  it("accepts a full lesson that teaches in its own words", () => {
    expect(lessonProblem(goodLesson(), NODE.checkpoints)).toBeNull();
  });

  it("rejects a lesson that pastes a checkpoint, so reading cannot become copy-paste into teach-back", () => {
    const lesson = goodLesson();
    lesson.checks[1].answer = NODE.checkpoints[1];
    expect(lessonProblem(lesson, NODE.checkpoints)).toMatch(/word for word/);
  });

  it("rejects a lesson too short for a 3 minute read, or missing a part", () => {
    expect(lessonProblem({ ...goodLesson(), idea: ["Short.", "Too short."] }, NODE.checkpoints)).toMatch(/words/);
    expect(lessonProblem({ ...goodLesson(), checks: goodLesson().checks.slice(0, 1) }, NODE.checkpoints)).toMatch(/checks/);
  });

  it("works out the reading time from the words", () => {
    const minutes = toLesson(goodLesson()).readingMinutes;
    expect(minutes).toBeGreaterThanOrEqual(3);
    expect(minutes).toBeLessThanOrEqual(5);
  });
});

describe("getOrCreateLesson", () => {
  it("writes the lesson once, saves it under lessons/<mapId>/<nodeId> for a posting map, and serves the saved copy after", async () => {
    const first = lessonIn(await getOrCreateLesson(mapId, NODE.id, OWNER));
    const second = lessonIn(await getOrCreateLesson(mapId, NODE.id, OWNER));
    expect(second).toEqual(first);
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(await getDoc(`lessons/${mapId}/${NODE.id}`)).toMatchObject({ lesson: first });
    expect(first.writtenBy?.model).toBeTruthy();
  });

  it("streams lines on the write profile, sends the checkpoints but never the source text", async () => {
    await getOrCreateLesson(mapId, NODE.id, OWNER);
    const options = mockStream.mock.calls[0][0];
    expect(options).toMatchObject({ profile: "write", label: "lesson", maxTokens: 12_000 });
    expect(options.totalMs).toBeLessThanOrEqual(60_000);
    expect(options.system).toBe(lessonLinesSystemPrompt(undefined, undefined));
    expect(options.prompt).toContain(NODE.checkpoints[0]);
    expect(options.prompt).not.toContain("SECRET POSTING TEXT");
  });

  it("never shows a line that copies a checkpoint, and rewrites the lesson once", async () => {
    const copied = linesOf(goodLesson());
    copied.splice(1, 0, { part: "idea", text: `Here it is: ${NODE.checkpoints[0]}` });
    mockStream.mockImplementationOnce(replyWith(copied)).mockImplementationOnce(replyWith(goodLesson()));

    const lesson = lessonIn(await getOrCreateLesson(mapId, NODE.id, OWNER));

    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(mockStream.mock.calls[1][0].prompt).toContain("word for word");
    expect(JSON.stringify(lesson)).not.toContain(NODE.checkpoints[0]);
  });

  it("takes all the idea paragraphs written in one line (Haiku's habit) as paragraphs, first time, with no rewrite", async () => {
    const raw = goodLesson();
    const lines = linesOf(raw).filter((line) => (line as { part: string }).part !== "idea");
    const merged = `${raw.idea[0]}\n\n${raw.idea[1]}\n\n> Tip: Draw the two lists first.\n\nA short list:\n- one\n- two`;
    mockStream.mockImplementationOnce(replyWith([{ part: "idea", text: merged }, ...lines]));

    const lesson = lessonIn(await getOrCreateLesson(mapId, NODE.id, OWNER));

    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(lesson.idea).toHaveLength(3);
    expect(lesson.idea[1]).toContain("\n> Tip: Draw the two lists first.");
    expect(lesson.idea[2]).toBe("A short list:\n- one\n- two");
  });

  it("still rejects a copied checkpoint hidden in one paragraph of a merged idea line", async () => {
    const raw = goodLesson();
    const rest = linesOf(raw).filter((line) => (line as { part: string }).part !== "idea");
    const merged = `${raw.idea[0]}\n\nIn short: ${NODE.checkpoints[1]}\n\n${raw.idea[1]}`;
    mockStream.mockImplementationOnce(replyWith([{ part: "idea", text: merged }, ...rest])).mockImplementationOnce(replyWith(goodLesson()));

    const lesson = lessonIn(await getOrCreateLesson(mapId, NODE.id, OWNER));

    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(lesson)).not.toContain(NODE.checkpoints[1]);
  });

  it("returns the parts written so far while someone else writes it, with no model call", async () => {
    const parts = [{ part: "idea", text: "First paragraph." }, { part: "practice", scenario: "S", question: "Q", modelAnswer: "SECRET ANSWER" }];
    const stop = fakeRunning(`lessons/${mapId}/${NODE.id}`, parts, 2);
    const reply = await getOrCreateLesson(mapId, NODE.id, OWNER);
    stop();
    expect(reply).toEqual({
      status: "writing",
      attempt: 2,
      parts: [{ part: "idea", text: "First paragraph." }, { part: "practice", scenario: "S", question: "Q" }],
    });
    expect(JSON.stringify(reply)).not.toContain("SECRET ANSWER");
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("starts the writer after the response when the route asks, and replies 'writing' at once", async () => {
    const tasks: (() => Promise<unknown>)[] = [];
    const reply = await getOrCreateLesson(mapId, NODE.id, OWNER, { background: (task) => void tasks.push(task) });
    expect(reply).toEqual({ status: "writing", attempt: 1, parts: [] });
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(lessonIn(await getOrCreateLesson(mapId, NODE.id, OWNER)).checks).toHaveLength(2);
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("says once that writing failed (503), then tries again on the next open", async () => {
    mockStream.mockRejectedValue(new Error("down"));
    const tasks: (() => Promise<unknown>)[] = [];
    await getOrCreateLesson(mapId, NODE.id, OWNER, { background: (task) => void tasks.push(task) });
    await tasks[0]();
    await expect(getOrCreateLesson(mapId, NODE.id, OWNER)).rejects.toMatchObject({ status: 503 });
    mockStream.mockImplementation(replyWith(goodLesson()));
    expect(lessonIn(await getOrCreateLesson(mapId, NODE.id, OWNER)).idea.length).toBeGreaterThan(0);
  });

  it("gives a stranger the same 404 as a missing map, before any model call", async () => {
    await expect(getOrCreateLesson(mapId, NODE.id, STRANGER)).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateLesson(randomUUID(), NODE.id, OWNER)).rejects.toMatchObject({ status: 404 });
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("lets anyone read once the map is published as a course", async () => {
    await publishCourse(mapId, OWNER);
    expect(lessonIn(await getOrCreateLesson(mapId, NODE.id, STRANGER)).checks).toEqual(expect.any(Array));
  });

  it("deletes a map's lessons for Delete my data, and ignores ids that are not UUIDs", async () => {
    await getOrCreateLesson(mapId, NODE.id, OWNER);
    expect(await deleteLessonsForMaps([mapId, "../maps"])).toBe(1);
    expect(await getDoc(`lessons/${mapId}/${NODE.id}`)).toBeNull();
    expect(await deleteLessonsForMaps([mapId])).toBe(0);
  });
});

describe("lessons of a catalog course", () => {
  async function courseMap(courseId: string, ownerId: string): Promise<string> {
    const id = randomUUID();
    await putDoc(`maps/${id}`, {
      id,
      ownerId,
      courseId,
      title: "Data analysis",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "Data analysis",
      nodes: [NODE],
      createdAt: new Date().toISOString(),
    } satisfies SkillMap);
    return id;
  }

  it("two maps of one course share one lesson, written once and keyed by the course id", async () => {
    const courseId = randomUUID();
    const mine = await courseMap(courseId, OWNER);
    const theirs = await courseMap(courseId, STRANGER);

    const [a, b] = await Promise.all([getOrCreateLesson(mine, NODE.id, OWNER), getOrCreateLesson(theirs, NODE.id, STRANGER)]);
    const c = await getOrCreateLesson(theirs, NODE.id, STRANGER);

    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(lessonIn(c)).toEqual(lessonIn("lesson" in a ? a : b));
    expect(await getDoc(`lessons/${courseId}/${NODE.id}`)).not.toBeNull();
    expect(await getDoc(`lessons/${mine}/${NODE.id}`)).toBeNull();
    // Delete my data takes map ids: the shared lesson stays.
    expect(await deleteLessonsForMaps([mine])).toBe(0);
    expect(await getDoc(`lessons/${courseId}/${NODE.id}`)).not.toBeNull();
  });

  it("ensureLesson writes ahead with no map, and skips what exists or cannot fit", async () => {
    const courseId = randomUUID();
    const course = { title: "Data analysis" };
    expect(await ensureLesson({ contentId: courseId, node: NODE, course, deadline: Date.now() + 10_000 })).toBe("no-time");
    expect(await ensureLesson({ contentId: courseId, node: NODE, course, deadline: Date.now() + 112_000 })).toBe("ready");
    expect(await ensureLesson({ contentId: courseId, node: NODE, course, deadline: Date.now() + 112_000 })).toBe("ready");
    expect(mockStream).toHaveBeenCalledTimes(1);
  });
});

describe("a locked skill", () => {
  it("gets no lesson written until it is unlocked, and no model call is spent", async () => {
    const lockedMapId = randomUUID();
    await putDoc(`maps/${lockedMapId}`, {
      id: lockedMapId,
      ownerId: OWNER,
      title: "Locked test",
      subtitle: "",
      sourceKind: "posting",
      sourceText: "",
      nodes: [NODE, { ...NODE, id: "later", prerequisites: [NODE.id] }],
      createdAt: new Date().toISOString(),
    } satisfies SkillMap);
    mockStream.mockClear();

    await expect(getOrCreateLesson(lockedMapId, "later", OWNER)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("locked"),
    });
    expect(mockStream).not.toHaveBeenCalled();
    expect(await getDoc(`lessons/${lockedMapId}/later`)).toBeNull();

    await unlockNode(OWNER, lockedMapId, "later");
    await expect(getOrCreateLesson(lockedMapId, "later", OWNER)).resolves.toBeDefined();
  });
});
