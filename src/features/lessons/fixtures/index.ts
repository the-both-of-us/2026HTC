import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import type { SkillMap, SkillNode } from "@/shared/types";
import { rawLessonSchema, type RawLesson } from "../prompt";
import dataAnalystGrid from "./data-analyst-grid.json";
import instrumentationRenewables from "./instrumentation-renewables.json";
import juniorBackend from "./junior-backend.json";

/** What scripts/cache-lessons.ts writes: real model output for each node of a sample map. */
export type SampleLessons = {
  sampleId: string;
  generatedAt: string;
  lessons: Record<string, { title: string; lesson: unknown }>;
};

const LESSONS_BY_SAMPLE_ID: Record<string, SampleLessons> = {
  "data-analyst-grid": dataAnalystGrid,
  "instrumentation-renewables": instrumentationRenewables,
  "junior-backend": juniorBackend,
};

/**
 * The saved lesson if this map was built from a sample posting and the node matches by id and
 * title. A sample map's checkpoints come from saved output too, so the lesson fits them.
 */
export function findSampleLesson(map: SkillMap, node: SkillNode): RawLesson | null {
  if (map.sourceKind !== "posting") return null;
  const sample = SAMPLE_POSTINGS.find((candidate) => candidate.text.trim() === map.sourceText.trim());
  const saved = sample && LESSONS_BY_SAMPLE_ID[sample.id]?.lessons[node.id];
  if (!saved || saved.title !== node.title) return null;
  return rawLessonSchema.parse(saved.lesson);
}
