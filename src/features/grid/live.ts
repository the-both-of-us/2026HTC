import { FAMILY_LABELS, outputOf } from "./metrics";
import type { GridReading, GridSnapshot } from "./types";

/** AESO normally updates every minute or two. Older than this, we say so even if the fetch worked. */
const REPORT_OLD_AFTER_MS = 15 * 60 * 1000;

export function isReportOld(snapshot: GridSnapshot, now: number): boolean {
  return now - new Date(snapshot.asOf).getTime() > REPORT_OLD_AFTER_MS;
}

export type LiveState = {
  reading: GridReading | null;
  /** The reading before this one, once the report's time has moved on. */
  previous: GridSnapshot | null;
};

/** A new reading arrives. If it has no numbers, keep the ones we have, marked stale. */
export function applyReading(state: LiveState, next: GridReading): LiveState {
  const current = state.reading;
  const held = current && current.status !== "unavailable" ? current : null;

  if (next.status === "unavailable") {
    return held ? { ...state, reading: { ...held, status: "stale" } } : { ...state, reading: next };
  }
  const moved = held && held.snapshot.asOf !== next.snapshot.asOf;
  return { reading: next, previous: moved ? held.snapshot : state.previous };
}

/** Our own request failed: same rule as an unavailable reading. */
export function markUnreachable(state: LiveState): LiveState {
  return applyReading(state, { status: "unavailable" });
}

export type GridChange = { label: string; delta: number };

/** What moved between two real readings. Only figures that changed are listed. */
export function changesBetween(before: GridSnapshot, after: GridSnapshot): GridChange[] {
  const families = ["wind", "solar", "gas"] as const;
  return [
    { label: "Load", delta: after.load - before.load },
    ...families.map((family) => ({
      label: FAMILY_LABELS[family],
      delta: outputOf(after, family) - outputOf(before, family),
    })),
  ].filter((change) => change.delta !== 0);
}
