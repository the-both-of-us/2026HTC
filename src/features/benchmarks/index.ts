/** Model benchmark results and the /settings/models page. */
import type { BenchResults } from "./shape";
import rawResults from "./results.json";

export { BENCHMARK_LINKS, MODELS, SUBJECTS, type ModelId } from "./catalog";
export { bestModels, defaultGap, pickModel, type BenchResults, type Score } from "./shape";
export { BenchmarksScreen } from "./ui/BenchmarksScreen";

/** The latest run of scripts/bench-models.ts. */
export const benchResults = rawResults as BenchResults;
