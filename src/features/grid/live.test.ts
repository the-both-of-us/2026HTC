import { describe, expect, it } from "vitest";
import { applyReading, changesBetween, isReadingStale, isReportOld, markUnreachable } from "./live";
import type { GridReading, GridSnapshot } from "./types";

const base: GridSnapshot = {
  asOf: "2026-11-07T13:16:00-06:00",
  asOfLabel: "Nov 07, 2026 13:16",
  load: 10000,
  generation: 10100,
  interchange: 100,
  reserveRequired: 400,
  reserveDispatched: 410,
  capabilityTotal: 20000,
  groups: [
    { name: "Wind", family: "wind", capability: 5000, output: 2000, reserve: 0 },
    { name: "Solar", family: "solar", capability: 1000, output: 500, reserve: 0 },
    { name: "Cogeneration", family: "gas", capability: 8000, output: 7600, reserve: 0 },
  ],
  paths: [],
  units: [],
};
const live = (snapshot: GridSnapshot): GridReading => ({
  status: "live",
  snapshot,
  fetchedAt: "2026-11-07T19:16:30.000Z",
});
const later = { ...base, asOf: "2026-11-07T13:18:00-06:00", asOfLabel: "Nov 07, 2026 13:18" };

describe("applyReading", () => {
  it("takes the first reading", () => {
    expect(applyReading({ reading: null, previous: null }, live(base))).toEqual({
      reading: live(base),
      previous: null,
    });
  });

  it("remembers the previous reading only when the report's time moves", () => {
    const first = applyReading({ reading: null, previous: null }, live(base));
    expect(applyReading(first, live(base)).previous).toBeNull();
    expect(applyReading(first, live(later)).previous).toEqual(base);
  });

  it("ignores a reading older than the one it has", () => {
    const current = applyReading({ reading: null, previous: null }, live(later));
    expect(applyReading(current, live(base))).toEqual(current);
    expect(applyReading(current, { status: "stale", snapshot: base, fetchedAt: "2026-11-07T19:16:30.000Z" })).toEqual(current);
  });

  it("keeps the numbers it has and marks them stale when AESO goes away", () => {
    const first = applyReading({ reading: null, previous: null }, live(base));
    const after = applyReading(first, { status: "unavailable" });
    expect(after.reading).toMatchObject({ status: "stale", snapshot: base });
  });

  it("shows nothing when there were never any numbers", () => {
    const after = markUnreachable({ reading: null, previous: null });
    expect(after.reading).toEqual({ status: "unavailable" });
  });

  it("recovers to live after a failure", () => {
    const first = applyReading({ reading: null, previous: null }, live(base));
    const failed = markUnreachable(first);
    expect(applyReading(failed, live(later)).reading?.status).toBe("live");
  });
});

describe("changesBetween", () => {
  it("lists only what moved", () => {
    const after = {
      ...later,
      load: 10012,
      groups: base.groups.map((group) =>
        group.family === "wind" ? { ...group, output: 1990 } : group,
      ),
    };
    expect(changesBetween(base, after)).toEqual([
      { label: "Load", delta: 12 },
      { label: "Wind", delta: -10 },
    ]);
  });
});

describe("isReadingStale", () => {
  const reportTime = new Date(base.asOf).getTime();

  it("is stale when the fetch failed, or when the report stopped moving", () => {
    expect(isReadingStale({ status: "stale", snapshot: base, fetchedAt: "" }, reportTime)).toBe(true);
    expect(isReadingStale({ status: "live", snapshot: base, fetchedAt: "" }, reportTime + 20 * 60 * 1000)).toBe(true);
  });

  it("is not stale for a live, recent report, or before the clock starts", () => {
    expect(isReadingStale({ status: "live", snapshot: base, fetchedAt: "" }, reportTime)).toBe(false);
    expect(isReadingStale({ status: "live", snapshot: base, fetchedAt: "" }, null)).toBe(false);
  });
});

describe("isReportOld", () => {
  const reportTime = new Date(base.asOf).getTime();

  it("trusts a recent report", () => {
    expect(isReportOld(base, reportTime + 5 * 60 * 1000)).toBe(false);
  });

  it("flags a report AESO has stopped updating", () => {
    expect(isReportOld(base, reportTime + 20 * 60 * 1000)).toBe(true);
  });
});
