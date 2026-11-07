import { monthName, parseLatest, quarterName, toPoint } from "./parse";
import type { LabourSnapshot, WagePoint } from "./types";

const WDS = "https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods";
const SOURCE = {
  name: "Statistics Canada",
  url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410028701",
};
const TTL_MS = 6 * 60 * 60 * 1000;

// Vectors checked against live StatCan responses on 2026-11-07.
// Table 14-10-0287-01 (Labour Force Survey, seasonally adjusted, 15+ years).
const CANADA = 2062815;
const ALBERTA = 2064516;
// Table 14-10-0459-01: Calgary CMA, three-month moving average, seasonally adjusted.
const CALGARY = 1643280342;
// Table 14-10-0444-01: Calgary economic region, average offered hourly wage.
const WAGES: { vectorId: number; occupation: string }[] = [
  { vectorId: 1569895855, occupation: "All occupations" },
  { vectorId: 1569896649, occupation: "Software engineers and designers" },
  { vectorId: 1569896651, occupation: "Software developers and programmers" },
  { vectorId: 1569896637, occupation: "Data scientists" },
  { vectorId: 1569896769, occupation: "Registered nurses" },
  { vectorId: 1569897167, occupation: "Electricians" },
];

async function fetchLatest(vectorIds: number[]) {
  const res = await fetch(WDS, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(vectorIds.map((vectorId) => ({ vectorId, latestN: 1 }))),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`StatCan answered ${res.status}`);
  return parseLatest(await res.json());
}

/** Build a snapshot from a fetch. Returns null if the headline numbers are missing. */
export async function loadSnapshot(): Promise<LabourSnapshot | null> {
  const [headline, wageRows] = await Promise.all([
    fetchLatest([CANADA, ALBERTA, CALGARY]),
    fetchLatest(WAGES.map((w) => w.vectorId)).catch(() => null),
  ]);
  const canada = headline.get(CANADA);
  const alberta = headline.get(ALBERTA);
  if (!canada || !alberta) return null;
  const calgary = headline.get(CALGARY);

  const wages: WagePoint[] = [];
  for (const w of WAGES) {
    const s = wageRows?.get(w.vectorId);
    if (s) {
      wages.push({ ...toPoint("Average offered hourly wage", s), occupation: w.occupation, qualityCode: s.qualityCode });
    }
  }

  return {
    unemployment: {
      canada: toPoint("Canada", canada),
      alberta: toPoint("Alberta", alberta),
      calgary: calgary ? toPoint("Calgary", calgary) : null,
    },
    wages,
    referencePeriod: monthName(alberta.period),
    wagePeriod: wages[0] ? quarterName(wages[0].period) : null,
    source: SOURCE,
    retrievedAt: new Date().toISOString(),
    stale: false,
  };
}

let cached: { at: number; snapshot: LabourSnapshot } | null = null;

/** Live numbers, cached for about 6 hours. Falls back to the last good copy, else null. */
export async function getLabourSnapshot(): Promise<LabourSnapshot | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.snapshot;
  try {
    const snapshot = await loadSnapshot();
    if (snapshot) {
      cached = { at: Date.now(), snapshot };
      return snapshot;
    }
  } catch {
    // fall through to the last good copy
  }
  return cached ? { ...cached.snapshot, stale: true } : null;
}

/** Test hook. */
export function clearLabourCache() {
  cached = null;
}
