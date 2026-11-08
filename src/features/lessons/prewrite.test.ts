import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { getOrCreateLesson } from "./lessons";
import { writeFirstLesson, writeFirstLessonSoon, writeNextLesson, writeNextLessonSoon } from "./prewrite";
import type { RawLesson } from "./prompt";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after: vi.fn() }));
const mockChatJSON = vi.mocked(chatJSON);
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
  vi.stubEnv("S3_BUCKET", "");
  mockChatJSON.mockReset();
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
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("writes one lesson, for the first open topic, and the Read tab then serves it with no model call", async () => {
    mockChatJSON.mockResolvedValue(LESSON);
    writeFirstLessonSoon(mapId);
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)();

    expect(mockChatJSON).toHaveBeenCalledOnce();
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ label: "lesson", preferredRoute: "gemini" });
    expect(await getDoc(`lessons/${mapId}/basics`)).not.toBeNull();
    expect(await getDoc(`lessons/${mapId}/later`)).toBeNull();
    expect(await getDoc(`lessons/${mapId}/other`)).toBeNull();

    const served = await getOrCreateLesson(mapId, "basics", OWNER);
    expect(served.idea.length).toBeGreaterThan(0);
    expect(mockChatJSON).toHaveBeenCalledOnce();
  });

  it("shares the call when the learner opens the tab while it is still being written", async () => {
    let finish: (lesson: RawLesson) => void = () => {};
    mockChatJSON.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    const ahead = writeFirstLesson(mapId);
    await vi.waitFor(() => expect(mockChatJSON).toHaveBeenCalledOnce());
    const opened = getOrCreateLesson(mapId, "basics", OWNER);
    finish(LESSON);
    await Promise.all([ahead, opened]);
    expect(mockChatJSON).toHaveBeenCalledOnce();
  });

  it("never throws when the model fails or the map is gone", async () => {
    mockChatJSON.mockRejectedValue(new Error("all providers failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(writeFirstLesson(mapId)).resolves.toBeUndefined();
    await expect(writeFirstLesson(randomUUID())).resolves.toBeUndefined();
    expect(await getDoc(`lessons/${mapId}/basics`)).toBeNull();
    warn.mockRestore();
  });
});

describe("writing the next lesson ahead", () => {
  it("only schedules the work, so the open lesson is not held up", () => {
    writeNextLessonSoon(mapId, "basics", OWNER);
    expect(mockAfter).toHaveBeenCalledOnce();
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("writes the next skill in the map's order that is open, skipping locked ones", async () => {
    mockChatJSON.mockResolvedValue(LESSON);
    // "later" comes first but is locked; after "basics" the next open one is "other".
    await writeNextLesson(mapId, "basics", OWNER);
    expect(mockChatJSON).toHaveBeenCalledOnce();
    expect(await getDoc(`lessons/${mapId}/other`)).not.toBeNull();
    expect(await getDoc(`lessons/${mapId}/later`)).toBeNull();
  });

  it("does nothing after the last skill, or for a stranger's private map", async () => {
    await writeNextLesson(mapId, "other", OWNER);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeNextLesson(mapId, "basics", randomUUID());
    warn.mockRestore();
    expect(mockChatJSON).not.toHaveBeenCalled();
  });
});

describe("the model router on lessons", () => {
  it("asks for a stronger model on a hard, high-stakes course and saves who wrote it", async () => {
    const map = await getDoc<SkillMap>(`maps/${mapId}`);
    await putDoc(`maps/${mapId}`, { ...map, rating: { difficulty: 3, stakes: 3 } });
    mockChatJSON.mockImplementation(async (options) => {
      options.onServed?.({ route: "anthropic", model: "claude-opus-5-5", ms: 12_400 });
      return LESSON;
    });

    const lesson = await getOrCreateLesson(mapId, "basics", OWNER);
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ tier: 4 });
    expect(lesson.writtenBy).toEqual({ model: "Claude Opus", ms: 12_400 });
  });

  it("keeps an everyday course on tier 1, and an old lesson without writtenBy still loads", async () => {
    mockChatJSON.mockResolvedValue(LESSON);
    const lesson = await getOrCreateLesson(mapId, "basics", OWNER);
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ tier: 1 });
    expect(lesson.writtenBy).toBeUndefined();
  });

  it("follows the learner's settings: Fast keeps even a hard course on tier 1", async () => {
    const map = await getDoc<SkillMap>(`maps/${mapId}`);
    await putDoc(`maps/${mapId}`, { ...map, rating: { difficulty: 3, stakes: 3 } });
    await putDoc(`settings/${OWNER}`, { speed: "fast", overrides: {} });
    mockChatJSON.mockResolvedValue(LESSON);

    await getOrCreateLesson(mapId, "basics", OWNER);
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ tier: 1 });
  });
});
