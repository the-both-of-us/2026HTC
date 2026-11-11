import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamLines } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { getOrCreateLesson } from "./lessons";
import { writeFirstLesson, writeFirstLessonSoon, writeUnitLessons, writeUnitLessonsSoon } from "./prewrite";
import type { RawLesson } from "./prompt";
import { lessonIn, replyWith } from "./testing";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  streamLines: vi.fn(),
}));
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after: vi.fn() }));
const mockStream = vi.mocked(streamLines);
const mockAfter = vi.mocked(after);

const OWNER = randomUUID();
const filler = "Picture two lists of names on paper, and you draw lines between the people on both. ";
const LESSON: RawLesson = {
  idea: [filler.repeat(10), filler.repeat(10)],
  example: { intro: filler.repeat(4), code: "SELECT 1;", after: filler.repeat(3) },
  mistakes: [1, 2, 3].map((n) => ({ mistake: `Mistake ${n}.`, fix: filler.repeat(2) })),
  checks: [
    { question: "First?", answer: "One." },
    { question: "Second?", answer: "Two." },
  ],
};

function node(id: string, prerequisites: string[] = []): SkillNode {
  return { id, title: id, why: "", prerequisites, fromSource: false, citation: null, checkpoints: [`${id} is checked`] };
}

let mapId: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockStream.mockReset();
  mockAfter.mockReset();
  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Brand-new topic",
    subtitle: "",
    sourceKind: "topic",
    sourceText: "",
    // A locked topic first in the list, so "first open" really means the first one with no prerequisites.
    nodes: [node("later", ["basics"]), node("basics"), node("other")],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

describe("writing the first lesson ahead", () => {
  it("only schedules the work, so the map's response is not held up", () => {
    writeFirstLessonSoon(mapId);
    expect(mockAfter).toHaveBeenCalledOnce();
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("writes one lesson, for the first open topic, and the Read tab then serves it with no model call", async () => {
    mockStream.mockImplementation(replyWith(LESSON));
    writeFirstLessonSoon(mapId);
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)();

    expect(mockStream).toHaveBeenCalledOnce();
    expect(mockStream.mock.calls[0][0]).toMatchObject({ label: "lesson", profile: "write" });
    expect(await getDoc(`lessons/${mapId}/basics`)).not.toBeNull();
    expect(await getDoc(`lessons/${mapId}/later`)).toBeNull();
    expect(await getDoc(`lessons/${mapId}/other`)).toBeNull();

    const served = lessonIn(await getOrCreateLesson(mapId, "basics", OWNER));
    expect(served.idea.length).toBeGreaterThan(0);
    expect(served.writtenBy?.model).toBeTruthy();
    expect(mockStream).toHaveBeenCalledOnce();
  });

  it("shows the learner the parts written so far when they open the tab mid-write, with no second call", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const lines = replyWith(LESSON);
    mockStream.mockImplementation(async (options) => {
      await options.onLine({ part: "idea", text: LESSON.idea[0] } as never, 0);
      await gate;
      return lines(options);
    });
    const ahead = writeFirstLesson(mapId);
    await vi.waitFor(() => expect(mockStream).toHaveBeenCalledOnce());
    const opened = await getOrCreateLesson(mapId, "basics", OWNER);
    expect(opened).toMatchObject({ status: "writing", parts: [{ part: "idea" }] });
    release();
    await ahead;
    expect(mockStream).toHaveBeenCalledOnce();
  });

  it("never throws when the model fails or the map is gone", async () => {
    mockStream.mockRejectedValue(new Error("unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(writeFirstLesson(mapId)).resolves.toBeUndefined();
    await expect(writeFirstLesson(randomUUID())).resolves.toBeUndefined();
    expect(await getDoc(`lessons/${mapId}/basics`)).toBeNull();
    warn.mockRestore();
  });
});

describe("writing the unit's next lessons ahead (rule 4)", () => {
  async function unitMap(): Promise<string> {
    const id = randomUUID();
    const inUnit = (nodeId: string, unitId: string) => ({ ...node(nodeId), unitId, topicId: nodeId });
    await putDoc(`maps/${id}`, {
      id,
      ownerId: OWNER,
      courseId: randomUUID(),
      title: "Course",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "Course",
      nodes: [inUnit("a", "u1"), inUnit("b", "u1"), inUnit("c", "u1"), inUnit("d", "u1"), inUnit("e", "u2")],
      createdAt: new Date().toISOString(),
    } satisfies SkillMap);
    return id;
  }

  it("only schedules the work, so the open lesson is not held up", () => {
    writeUnitLessonsSoon(mapId, "basics");
    expect(mockAfter).toHaveBeenCalledOnce();
    expect(mockStream).not.toHaveBeenCalled();
  });

  it("writes up to 2 unwritten lessons after this one in the same unit, in parallel", async () => {
    const id = await unitMap();
    const map = (await getDoc<SkillMap>(`maps/${id}`))!;
    mockStream.mockImplementation(replyWith(LESSON));
    await putDoc(`lessons/${map.courseId}/b`, { lesson: { idea: ["saved"] }, createdAt: "x" });

    await writeUnitLessons(id, "a");

    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(await getDoc(`lessons/${map.courseId}/c`)).not.toBeNull();
    expect(await getDoc(`lessons/${map.courseId}/d`)).not.toBeNull();
    // Never past the unit.
    expect(await getDoc(`lessons/${map.courseId}/e`)).toBeNull();
  });

  it("does nothing after the unit's last topic, or when no time is left", async () => {
    const id = await unitMap();
    await writeUnitLessons(id, "d");
    await writeUnitLessons(id, "a", Date.now() + 5_000);
    expect(mockStream).not.toHaveBeenCalled();
  });
});
