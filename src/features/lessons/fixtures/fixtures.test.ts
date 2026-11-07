import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { generateSkillMap } from "@/features/skill-map";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { getOrCreateLesson } from "../lessons";
import { lessonProblem } from "../validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.mocked(chatJSON).mockReset();
});

// If a sample map changes, this fails: run scripts/cache-lessons.ts again.
describe.each(SAMPLE_POSTINGS)("saved lessons for $id", (sample) => {
  it("cover every skill with no model call, and none pastes a checkpoint", async () => {
    const owner = randomUUID();
    const map = await generateSkillMap({ text: sample.text, kind: "posting", ownerId: owner });

    for (const node of map.nodes) {
      const lesson = await getOrCreateLesson(map.id, node.id, owner);
      expect(lessonProblem(lesson, node.checkpoints), node.id).toBeNull();
      expect(lesson.readingMinutes, node.id).toBeGreaterThanOrEqual(3);
    }
    expect(chatJSON).not.toHaveBeenCalled();
  });
});
