import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import type { SkillMap } from "@/shared/types";
import { rawCardsSchema, type RawCards } from "../prompt";
import dataAnalystGrid from "./data-analyst-grid.json";
import instrumentationRenewables from "./instrumentation-renewables.json";
import juniorBackend from "./junior-backend.json";

/** What scripts/cache-feed.ts writes: real model output for each sample map. */
export type SampleCards = { sampleId: string; generatedAt: string; output: unknown };

const CARDS_BY_SAMPLE_ID: Record<string, SampleCards> = {
  "data-analyst-grid": dataAnalystGrid,
  "instrumentation-renewables": instrumentationRenewables,
  "junior-backend": juniorBackend,
};

/** The saved cards if this map was built from a sample posting, so the demo feed needs no model call. */
export function findSampleCards(map: Pick<SkillMap, "sourceKind" | "sourceText">): RawCards | null {
  if (map.sourceKind !== "posting") return null;
  const sample = SAMPLE_POSTINGS.find((candidate) => candidate.text.trim() === map.sourceText.trim());
  const saved = sample && CARDS_BY_SAMPLE_ID[sample.id];
  if (!saved?.output) return null;
  const parsed = rawCardsSchema.safeParse(saved.output);
  return parsed.success ? parsed.data : null;
}
