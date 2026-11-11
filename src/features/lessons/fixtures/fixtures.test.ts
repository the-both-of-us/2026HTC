import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON, streamLines } from "@/features/ai";
import { generateSkillMap } from "@/features/skill-map";
import { unlockNode } from "@/features/teachback";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { getOrCreateLesson } from "../lessons";
import { lessonIn } from "../testing";
import { lessonProblem } from "../validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
  streamLines: vi.fn(),
}));
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.mocked(chatJSON).mockReset();
});

// If a sample map changes, this fails: run scripts/cache-lessons.ts again.
describe.each(SAMPLE_POSTINGS)("saved lessons for $id", (sample) => {
  it("cover every skill with no model call, and none pastes a checkpoint", async () => {
    const owner = randomUUID();
    const map = await generateSkillMap({ text: sample.text, kind: "posting", ownerId: owner });

    for (const node of map.nodes) {
      // Lessons are only written for open skills, so open each one the learner's way.
      await unlockNode(owner, map.id, node.id);
      const lesson = lessonIn(await getOrCreateLesson(map.id, node.id, owner));
      expect(lessonProblem(lesson, node.checkpoints), node.id).toBeNull();
      expect(lesson.readingMinutes, node.id).toBeGreaterThanOrEqual(3);
    }
    expect(chatJSON).not.toHaveBeenCalled();
    expect(streamLines).not.toHaveBeenCalled();
  });
});
