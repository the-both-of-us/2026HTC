import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { rawPlanSchema, type RawPlan } from "../plan";
import juniorBackend from "./junior-backend-program.json";

/**
 * Real model output for the sample program, written by scripts/cache-sample-program.ts:
 * the plan, and the first course's map, so the demo opens with no AI wait. Other
 * courses are built live when opened, like any program's.
 */
type SavedProgram = { plan: unknown; courses: Record<string, unknown> };
const PROGRAM_BY_SAMPLE_ID: Record<string, SavedProgram> = {
  "junior-backend": juniorBackend,
};

/** Saved plan and course output if this text is exactly a sample posting with a saved program. */
export function findSampleProgram(
  text: string,
): { sampleId: string; plan: RawPlan; courses: Record<string, unknown> } | null {
  const sample = SAMPLE_POSTINGS.find((candidate) => candidate.text.trim() === text.trim());
  const saved = sample && PROGRAM_BY_SAMPLE_ID[sample.id];
  return saved ? { sampleId: sample.id, plan: rawPlanSchema.parse(saved.plan), courses: saved.courses } : null;
}

/** True when the text is a sample posting at all, saved program or not. */
export function isSamplePosting(text: string): boolean {
  return SAMPLE_POSTINGS.some((sample) => sample.text.trim() === text.trim());
}

/** Saved model output for one course of a sample program, or undefined. */
export function sampleCourseOutput(sampleId: string | undefined, slug: string): unknown {
  return sampleId ? PROGRAM_BY_SAMPLE_ID[sampleId]?.courses[slug] : undefined;
}
