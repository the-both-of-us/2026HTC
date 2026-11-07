import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { publishCourse } from "@/features/courses";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { deleteLessonsForMaps, getOrCreateLesson } from "./lessons";
import type { RawLesson } from "./prompt";
import { copiedCheckpoint, lessonProblem, toLesson } from "./validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

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
  vi.stubEnv("S3_BUCKET", "");
  mockChatJSON.mockReset();
  mockChatJSON.mockResolvedValue(goodLesson());
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
  it("writes the lesson once, saves it under lessons/<mapId>/<nodeId>, and serves the saved copy after", async () => {
    const first = await getOrCreateLesson(mapId, NODE.id, OWNER);
    const second = await getOrCreateLesson(mapId, NODE.id, OWNER);
    expect(second).toEqual(first);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(await getDoc(`lessons/${mapId}/${NODE.id}`)).toMatchObject({ lesson: first });
  });

  it("prefers Gemini, sends the checkpoints but never the source text, and its schema refuses a pasted checkpoint", async () => {
    await getOrCreateLesson(mapId, NODE.id, OWNER);
    const options = mockChatJSON.mock.calls[0][0];
    expect(options.preferredRoute).toBe("gemini");
    expect(options.prompt).toContain(NODE.checkpoints[0]);
    expect(options.prompt).not.toContain("SECRET POSTING TEXT");

    const copied = goodLesson();
    copied.idea[0] += ` ${NODE.checkpoints[0]}`;
    expect(options.schema.safeParse(copied).success).toBe(false);
    expect(options.schema.safeParse(goodLesson()).success).toBe(true);
  });

  it("gives a stranger the same 404 as a missing map, before any model call", async () => {
    await expect(getOrCreateLesson(mapId, NODE.id, STRANGER)).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateLesson(randomUUID(), NODE.id, OWNER)).rejects.toMatchObject({ status: 404 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("lets anyone read once the map is published as a course", async () => {
    await publishCourse(mapId, OWNER);
    await expect(getOrCreateLesson(mapId, NODE.id, STRANGER)).resolves.toMatchObject({ checks: expect.any(Array) });
  });

  it("deletes a map's lessons for Delete my data, and ignores ids that are not UUIDs", async () => {
    await getOrCreateLesson(mapId, NODE.id, OWNER);
    expect(await deleteLessonsForMaps([mapId, "../maps"])).toBe(1);
    expect(await getDoc(`lessons/${mapId}/${NODE.id}`)).toBeNull();
    expect(await deleteLessonsForMaps([mapId])).toBe(0);
  });
});
