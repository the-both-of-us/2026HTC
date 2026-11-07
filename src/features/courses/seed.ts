/** Publishes the sample postings as courses, so the directory is never empty. */
import { generateSkillMap, getSkillMap } from "@/features/skill-map";
import { SAMPLE_POSTINGS, type SamplePosting } from "@/shared/samplePostings";
import { getDoc, putDoc } from "@/shared/store";
import { getListing, saveListing } from "./listing";
import { SEED_AUTHOR_NAME } from "./rules";

export { SEED_AUTHOR_NAME };

/**
 * The owner of the seeded maps. It is deliberately not a UUID: identity only accepts a
 * UUID from the cookie, so no visitor can ever hold this id and edit or unpublish a seed,
 * even though the value is in public source code.
 */
export const SEED_OWNER_ID = "oryxlearn-sample-courses";

/** After a sample fails to seed, wait this long before trying it again, so a broken seed can't run on every request. */
export const RETRY_AFTER_FAILURE_MS = 5 * 60_000;
/** After every sample checked out, skip the checks for this long. Listing the directory is then one store list. */
export const RECHECK_AFTER_MS = 60_000;

type SeedDoc = { mapId: string; seededAt: string };

type SeedState = {
  inFlight: Promise<string[]> | null;
  /** The sample map ids from the last check where every sample was fine. */
  checked: { at: number; mapIds: string[] } | null;
  failedAt: Map<string, number>;
  /**
   * The last map id each sample was seen with. While a sample waits to retry after a
   * failure (often just one failed store read), this id stands in for it, so its intact
   * listing is not hidden as a duplicate.
   */
  known: Map<string, string>;
};

// On globalThis, because Next.js can load this file once per route and they must share one run.
const globalSeed = globalThis as typeof globalThis & { oryxCourseSeeding?: SeedState };
const state = (globalSeed.oryxCourseSeeding ??= {
  inFlight: null,
  checked: null,
  failedAt: new Map(),
  known: new Map(),
});
// A state left on globalThis by an older copy of this file (dev hot reload) may lack this field.
state.known ??= new Map();

function seedKey(sampleId: string): string {
  return `course-seeds/${sampleId}`;
}

/**
 * Makes sure each sample posting is a published course. Safe to call on every request:
 * it is idempotent, and concurrent calls share one run. A sample that fails is logged and
 * skipped, so the others still list. The sample postings have saved model output, so
 * seeding makes no AI call.
 *
 * Returns the map ids of the current sample courses. A sample that is failing is
 * represented by the last id it was seen with, or left out if it has never been seen
 * since this server started.
 */
export function ensureSampleCourses(): Promise<string[]> {
  if (state.checked && Date.now() - state.checked.at < RECHECK_AFTER_MS) {
    return Promise.resolve(state.checked.mapIds);
  }
  // No await between this check and the set below, so concurrent callers share one promise.
  if (state.inFlight) return state.inFlight;
  const work = seedAll().finally(() => {
    state.inFlight = null;
  });
  state.inFlight = work;
  return work;
}

async function seedAll(): Promise<string[]> {
  const mapIds: string[] = [];
  let allFine = true;

  // One at a time, in order, so the samples get distinct publish times.
  for (const sample of SAMPLE_POSTINGS) {
    let mapId: string | null = null;
    try {
      mapId = await seedOne(sample);
    } catch (error) {
      state.failedAt.set(sample.id, Date.now());
      console.error(`[courses] could not seed the sample course "${sample.id}"`, error);
    }
    if (mapId) {
      state.known.set(sample.id, mapId);
      mapIds.push(mapId);
    } else {
      allFine = false;
      const lastKnown = state.known.get(sample.id);
      if (lastKnown) mapIds.push(lastKnown);
    }
  }

  state.checked = allFine ? { at: Date.now(), mapIds } : null;
  return mapIds;
}

/** Returns the sample's map id, or null while it is waiting to retry after a failure. */
async function seedOne(sample: SamplePosting): Promise<string | null> {
  const failedAt = state.failedAt.get(sample.id);
  if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return null;

  const seed = await getDoc<SeedDoc>(seedKey(sample.id));
  const existing = seed ? await getSkillMap(seed.mapId) : null;
  if (existing) {
    // The map is fine. Put the listing back if it went missing.
    if (!(await getListing(existing.id))) {
      await saveListing(existing, { authorName: SEED_AUTHOR_NAME, isSample: true });
    }
    state.failedAt.delete(sample.id);
    return existing.id;
  }

  const map = await generateSkillMap({ text: sample.text, kind: "posting", ownerId: SEED_OWNER_ID });
  await saveListing(map, { authorName: SEED_AUTHOR_NAME, isSample: true });
  await putDoc(seedKey(sample.id), { mapId: map.id, seededAt: new Date().toISOString() } satisfies SeedDoc);
  state.failedAt.delete(sample.id);
  return map.id;
}

/** Forgets cached checks, failures and runs. Tests only. */
export function resetSeedStateForTests(): void {
  state.inFlight = null;
  state.checked = null;
  state.failedAt.clear();
  state.known.clear();
}
