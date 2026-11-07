import type { LabourPoint } from "./types";

type RawDataPoint = { refPer: string; value: number | null; statusCode?: number };
type RawResult = {
  status: string;
  object?: { vectorId: number; vectorDataPoint?: RawDataPoint[] };
};

export type ParsedSeries = {
  vectorId: number;
  period: string;
  value: number;
  qualityCode: number;
};

/** Turn the WDS getDataFromVectorsAndLatestNPeriods reply into the latest point per vector. */
export function parseLatest(raw: unknown): Map<number, ParsedSeries> {
  const out = new Map<number, ParsedSeries>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw as RawResult[]) {
    if (item?.status !== "SUCCESS" || !item.object) continue;
    const points = (item.object.vectorDataPoint ?? []).filter(
      (p) => typeof p.value === "number" && typeof p.refPer === "string",
    );
    const last = points.sort((a, b) => a.refPer.localeCompare(b.refPer)).at(-1);
    if (!last) continue;
    out.set(item.object.vectorId, {
      vectorId: item.object.vectorId,
      period: last.refPer.slice(0, 7),
      value: last.value as number,
      qualityCode: last.statusCode ?? 0,
    });
  }
  return out;
}

export function toPoint(label: string, s: ParsedSeries): LabourPoint {
  return { label, value: s.value, period: s.period, vectorId: s.vectorId };
}

/** "2026-10" -> "October 2026". */
export function monthName(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${names[m - 1]} ${y}`;
}

/** "2026-04" -> "Q2 2026" (quarterly series are dated by the first month). */
export function quarterName(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}
