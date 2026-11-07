import { getDoc, putDoc } from "@/shared/store";
import { parseCurrentSupplyDemand } from "./parse";
import { AESO_REPORT_URL, type GridReading, type GridSnapshot } from "./types";

const FRESH_FOR_MS = 60 * 1000;
/** After a failure, wait before trying again, so an AESO outage doesn't slow every request. */
const RETRY_AFTER_MS = 15 * 1000;
const FETCH_TIMEOUT_MS = 8 * 1000;
/** Saving is only for surviving a restart, so once every five minutes is plenty. */
const SAVE_EVERY_MS = 5 * 60 * 1000;
const LAST_GOOD_KEY = "grid/last-good";

type Saved = { snapshot: GridSnapshot; fetchedAt: string };

type CacheState = {
  good: (Saved & { fetchedAtMs: number }) | null;
  lastFailureMs: number;
  lastSavedMs: number;
  inFlight: Promise<GridReading> | null;
};

const emptyCache = (): CacheState => ({ good: null, lastFailureMs: 0, lastSavedMs: 0, inFlight: null });

// On globalThis because Next.js can load this file once per route, and they should share a cache.
const globalCache = globalThis as typeof globalThis & { oryxGridCache?: CacheState };
const cache = (globalCache.oryxGridCache ??= emptyCache());

async function fetchFromAeso(): Promise<GridSnapshot> {
  const response = await fetch(AESO_REPORT_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "OryxLearn (student hackathon project; learning exercises)" },
  });
  if (!response.ok) throw new Error(`AESO answered ${response.status}`);
  return parseCurrentSupplyDemand(await response.text());
}

/** The last good reading, from memory or else from the store. Null if there has never been one. */
async function lastGood(): Promise<GridReading> {
  if (cache.good) {
    return { status: "stale", snapshot: cache.good.snapshot, fetchedAt: cache.good.fetchedAt };
  }
  try {
    const saved = await getDoc<Saved>(LAST_GOOD_KEY);
    if (saved) return { status: "stale", snapshot: saved.snapshot, fetchedAt: saved.fetchedAt };
  } catch (error) {
    console.warn("[grid] could not read the saved reading", error);
  }
  return { status: "unavailable" };
}

async function refresh(now: number): Promise<GridReading> {
  try {
    const snapshot = await fetchFromAeso();
    const fetchedAt = new Date(now).toISOString();
    cache.good = { snapshot, fetchedAt, fetchedAtMs: now };
    cache.lastFailureMs = 0;

    if (now - cache.lastSavedMs >= SAVE_EVERY_MS) {
      cache.lastSavedMs = now;
      await putDoc(LAST_GOOD_KEY, { snapshot, fetchedAt } satisfies Saved).catch((error) => {
        console.warn("[grid] could not save the reading", error);
      });
    }
    return { status: "live", snapshot, fetchedAt };
  } catch (error) {
    console.warn("[grid] could not read AESO", error);
    cache.lastFailureMs = now;
    return lastGood();
  }
}

/**
 * The current grid reading. It reads AESO at most about once a minute, and on any failure falls
 * back to the last good reading with its real time, or says it has nothing.
 */
export async function getGridReading(now: number = Date.now()): Promise<GridReading> {
  const { good } = cache;
  if (good && now - good.fetchedAtMs < FRESH_FOR_MS) {
    return { status: "live", snapshot: good.snapshot, fetchedAt: good.fetchedAt };
  }
  if (now - cache.lastFailureMs < RETRY_AFTER_MS) return lastGood();

  // Requests that arrive together share one fetch.
  cache.inFlight ??= refresh(now).finally(() => {
    cache.inFlight = null;
  });
  return cache.inFlight;
}

/** For tests only. */
export function resetGridCache() {
  Object.assign(cache, emptyCache());
}
