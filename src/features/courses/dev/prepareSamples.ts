/**
 * Makes and saves the flashcards and quiz for every skill of the three sample courses,
 * so the demo never waits on a model for them. Run once with the AI keys and the store
 * settings in .env.local. Safe to run again: saved items are skipped.
 *
 *   npx tsx --env-file=.env.local src/features/courses/dev/prepareSamples.ts [--dry-run] [--only=flashcards|quiz] [--gap-ms=13000]
 *
 * Works on Node 20 and later (see allowServerOnly.ts).
 *
 * Prints env names, never their values, and never provider text.
 */
// First, so "server-only" is a no-op before any server code loads.
import "./allowServerOnly";
import { randomUUID } from "node:crypto";
import { ensureSampleCourses } from "@/features/courses";
import { getOrCreateFlashcards, getSavedFlashcards } from "@/features/flashcards";
import { getOrCreateQuiz, getSavedQuiz } from "@/features/quiz";
import { getSkillMap } from "@/features/skill-map";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { getDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import {
  buildPlan,
  countLabel,
  describeError,
  estimateMinutes,
  isRunDirectly,
  kindsFor,
  parseArgs,
  progressLine,
  safeConsoleLine,
  storeDriverName,
  storeRefusal,
  summaryLine,
  UsageError,
  USAGE,
  waitBeforeNextMs,
  type Kind,
  type Options,
  type PlanMap,
  type Summary,
} from "./plan";

export type Deps = {
  env: Record<string, string | undefined>;
  ensureSampleCourses: () => Promise<unknown>;
  /** The map id seeded for a sample posting, from course-seeds/<sampleId>. */
  readSeedMapId: (sampleId: string) => Promise<string | null>;
  getMap: (mapId: string) => Promise<SkillMap | null>;
  getSaved: (kind: Kind, mapId: string, nodeId: string, viewerId: string) => Promise<unknown[] | null>;
  create: (kind: Kind, mapId: string, nodeId: string, viewerId: string) => Promise<unknown[]>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
};

export const realDeps: Deps = {
  env: process.env,
  ensureSampleCourses,
  readSeedMapId: async (sampleId) => {
    const seed = await getDoc<{ mapId?: unknown }>(`course-seeds/${sampleId}`);
    return typeof seed?.mapId === "string" ? seed.mapId : null;
  },
  getMap: getSkillMap,
  getSaved: (kind, mapId, nodeId, viewerId) =>
    kind === "flashcards" ? getSavedFlashcards(mapId, nodeId, viewerId) : getSavedQuiz(mapId, nodeId, viewerId),
  create: (kind, mapId, nodeId, viewerId) =>
    kind === "flashcards" ? getOrCreateFlashcards(mapId, nodeId, viewerId) : getOrCreateQuiz(mapId, nodeId, viewerId),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
};

/**
 * Runs the whole job and returns the exit code. Every failure is logged and counted, and
 * the run goes on to the next item.
 */
export async function run(argv: readonly string[], deps: Deps): Promise<number> {
  const { log, env } = deps;

  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    log(error.message);
    log(USAGE);
    return 1;
  }

  const refusal = storeRefusal(env, options.dryRun);
  if (refusal) {
    log(refusal);
    return 1;
  }

  return withSafeConsole(log, () => work(options, deps));
}

/**
 * While the job runs, app code that logs a raw error (seeding logs the store's error
 * object, which can name the AWS access key id) prints only a safe line instead.
 */
async function withSafeConsole<T>(log: (line: string) => void, job: () => Promise<T>): Promise<T> {
  const saved = { error: console.error, warn: console.warn, info: console.info };
  const safe = (...args: unknown[]) => log(safeConsoleLine(args));
  console.error = safe;
  console.warn = safe;
  console.info = safe;
  try {
    return await job();
  } finally {
    console.error = saved.error;
    console.warn = saved.warn;
    console.info = saved.info;
  }
}

async function work(options: Options, deps: Deps): Promise<number> {
  const { log, env } = deps;
  const driver = storeDriverName(env);
  log(`Store: ${driver ?? "memory (dry run only: nothing is kept)"}.`);
  log(
    env.GEMINI_API_KEY
      ? "AI: GEMINI_API_KEY is set, so Gemini is asked first."
      : "AI: GEMINI_API_KEY is not set, so the usual provider order answers.",
  );
  if (options.dryRun) log("Dry run: no model is called and nothing is made.");

  const summary: Summary = { made: 0, alreadyThere: 0, failed: 0 };

  // Seeding uses saved model output, so it makes no AI call. It is what /courses does on every visit.
  try {
    await deps.ensureSampleCourses();
  } catch (error) {
    log(`Could not check the sample courses: ${describeError(error)}`);
    return 1;
  }

  const maps: PlanMap[] = [];
  for (const sample of SAMPLE_POSTINGS) {
    try {
      const mapId = await deps.readSeedMapId(sample.id);
      const map = mapId ? await deps.getMap(mapId) : null;
      if (!map) {
        summary.failed += 1;
        log(`Could not find the sample course for "${sample.label}". Open /courses once, then run this again.`);
        continue;
      }
      maps.push({
        sampleId: sample.id,
        label: sample.label,
        mapId: map.id,
        nodes: map.nodes.map((node) => ({ id: node.id, title: node.title })),
      });
    } catch (error) {
      summary.failed += 1;
      log(`Could not read the sample course for "${sample.label}": ${describeError(error)}`);
    }
  }

  // Seeded courses are published, so any viewer may read them. This id is never saved.
  const viewerId = randomUUID();
  const plan = await buildPlan(maps, kindsFor(options.only), async (kind, mapId, nodeId) => {
    return (await deps.getSaved(kind, mapId, nodeId, viewerId)) !== null;
  });
  const toMake = plan.filter((item) => !item.saved).length;
  log(
    `Plan: ${plan.length} items across ${maps.length} sample courses. ${plan.length - toMake} already saved, ` +
      `${toMake} to make, one every ${options.gapMs / 1000} s (about ${estimateMinutes(toMake, options.gapMs)} min).`,
  );

  let lastStartedAt: number | null = null;
  for (const [index, item] of plan.entries()) {
    const prefix = progressLine(index, plan.length, item);
    if (item.saved) {
      summary.alreadyThere += 1;
      log(`${prefix} already saved`);
      continue;
    }
    if (options.dryRun) {
      log(`${prefix} would make`);
      continue;
    }

    const waitMs = waitBeforeNextMs(lastStartedAt, deps.now(), options.gapMs);
    if (waitMs > 0) await deps.sleep(waitMs);
    lastStartedAt = deps.now();

    try {
      const items = await deps.create(item.kind, item.mapId, item.nodeId, viewerId);
      summary.made += 1;
      log(`${prefix} saved ${countLabel(item.kind, items.length)}`);
    } catch (error) {
      summary.failed += 1;
      log(`${prefix} failed: ${describeError(error)}`);
    }
  }

  if (options.dryRun) {
    log(`Dry run done: ${toMake} to make, ${plan.length - toMake} already saved, ${summary.failed} failed.`);
  } else {
    log(summaryLine(summary));
  }
  return summary.failed > 0 ? 1 : 0;
}

export async function main(): Promise<void> {
  try {
    process.exitCode = await run(process.argv.slice(2), realDeps);
  } catch (error) {
    console.log(`Stopped: ${describeError(error)}`);
    process.exitCode = 1;
  }
}

// Only when run as a script, never when a test imports this file.
if (isRunDirectly(process.argv[1])) {
  void main();
}
