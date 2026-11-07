import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { rawMapSchema, type RawSkillMap } from "../prompt";
import dataAnalystGrid from "./data-analyst-grid.json";
import instrumentationRenewables from "./instrumentation-renewables.json";
import juniorBackend from "./junior-backend.json";

/**
 * Real model output for the sample postings, written by scripts/cache-samples.ts.
 * Each file holds what the model replied before validation, so a cached map goes
 * through the same checks as a live one.
 */
const OUTPUT_BY_SAMPLE_ID: Record<string, { output: unknown }> = {
  "data-analyst-grid": dataAnalystGrid,
  "instrumentation-renewables": instrumentationRenewables,
  "junior-backend": juniorBackend,
};

/** Returns saved model output if this text is exactly a sample posting. */
export function findCachedOutput(posting: string): RawSkillMap | null {
  const sample = SAMPLE_POSTINGS.find((candidate) => candidate.text.trim() === posting.trim());
  const fixture = sample && OUTPUT_BY_SAMPLE_ID[sample.id];
  return fixture ? rawMapSchema.parse(fixture.output) : null;
}
