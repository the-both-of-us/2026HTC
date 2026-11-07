import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { familyOf, GridParseError, parseCurrentSupplyDemand, parseReportTime } from "./parse";

/** A real report, saved from AESO on 2026-11-07 at 13:16 Alberta time. */
const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/csd-2026-11-07-1316.html", import.meta.url)),
  "utf8",
);

describe("parseCurrentSupplyDemand on a real AESO report", () => {
  const snapshot = parseCurrentSupplyDemand(fixture);

  it("reads the report time, in AESO's words and as an instant", () => {
    expect(snapshot.asOfLabel).toBe("Nov 07, 2026 13:16");
    expect(snapshot.asOf).toBe("2026-11-07T13:16:00-06:00");
    // The fixture's HTTP response carried a date of 19:16:55 GMT.
    expect(new Date(snapshot.asOf).toISOString()).toBe("2026-11-07T19:16:00.000Z");
  });

  it("reads the summary", () => {
    expect(snapshot.generation).toBe(10900);
    expect(snapshot.interchange).toBe(182);
    expect(snapshot.load).toBe(10718);
    expect(snapshot.reserveRequired).toBe(479);
    expect(snapshot.reserveDispatched).toBe(510);
  });

  it("does not confuse total reserve with its Gen and Other rows", () => {
    expect(snapshot.reserveDispatched).not.toBe(435);
    expect(snapshot.reserveDispatched).not.toBe(75);
  });

  it("reads all nine fuel groups with capability, output and reserve", () => {
    expect(snapshot.groups).toHaveLength(9);
    expect(snapshot.groups.find((group) => group.name === "Wind")).toEqual({
      name: "Wind",
      family: "wind",
      capability: 5684,
      output: 2681,
      reserve: 0,
    });
    expect(snapshot.groups.find((group) => group.name === "Combined cycle")?.family).toBe("gas");
    expect(snapshot.capabilityTotal).toBe(23418);
  });

  it("has groups that add up to AESO's own totals", () => {
    const sum = (key: "capability" | "output") =>
      snapshot.groups.reduce((total, group) => total + group[key], 0);
    expect(sum("output")).toBe(snapshot.generation);
    expect(sum("capability")).toBe(snapshot.capabilityTotal);
  });

  it("confirms that a positive interchange means exporting", () => {
    expect(snapshot.generation - snapshot.interchange).toBe(snapshot.load);
  });

  it("reads the interchange paths, which add up to the net figure", () => {
    expect(snapshot.paths).toEqual([
      { path: "British Columbia", flow: 140 },
      { path: "Montana", flow: 42 },
      { path: "Saskatchewan", flow: 0 },
    ]);
    expect(snapshot.paths.reduce((total, path) => total + path.flow, 0)).toBe(snapshot.interchange);
  });

  it("reads every asset with its name, code, group and markers", () => {
    const shepard = snapshot.units.find((unit) => unit.code === "EGC1");
    expect(shepard).toMatchObject({
      name: "Shepard",
      group: "Combined cycle",
      family: "gas",
      capability: 868,
      output: 436,
      netToGrid: false,
    });
    expect(snapshot.units.find((unit) => unit.code === "CNR5")?.netToGrid).toBe(true);
    expect(snapshot.units.find((unit) => unit.code === "KKP2")).toMatchObject({
      family: "solar",
      netToGrid: true,
      hasStorage: true,
    });
    expect(snapshot.units.find((unit) => unit.group === "Biomass and other")?.family).toBe("other");
  });

  it("has assets whose output adds up to each fuel group", () => {
    for (const group of snapshot.groups) {
      const family = snapshot.units.filter((unit) =>
        group.family === "gas" ? unit.group === group.name : unit.family === group.family,
      );
      const output = family.reduce((total, unit) => total + unit.output, 0);
      expect(Math.abs(output - group.output), group.name).toBeLessThanOrEqual(2);
    }
  });
});

describe("parseCurrentSupplyDemand's tolerance", () => {
  it("handles commas, lower case and a reversed summary order", () => {
    const html = `<table>
      <tr><td>last update: Dec 01, 2026 09:05</td></tr>
      <tr><th>summary</th></tr>
      <tr><td>Alberta Internal Load (AIL)</td><td>9,500</td></tr>
      <tr><td>Net Actual Interchange</td><td>-250</td></tr>
      <tr><td>Alberta Total Net Generation</td><td>9,250</td></tr>
      <tr><th>generation</th></tr>
      <tr><td>group</td><td>mc</td><td>tng</td><td>dcr</td></tr>
      <tr><td>Energy Storage</td><td>270</td><td>-15</td><td>-</td></tr>
      <tr><td>Cogeneration</td><td>10,000</td><td>9,265</td><td>-</td></tr>
    </table>`;
    const snapshot = parseCurrentSupplyDemand(html);
    expect(snapshot.load).toBe(9500);
    expect(snapshot.interchange).toBe(-250);
    expect(snapshot.asOf).toBe("2026-12-01T09:05:00-06:00");
    expect(snapshot.groups[0]).toMatchObject({ family: "storage", output: -15, reserve: null });
    expect(snapshot.reserveRequired).toBeNull();
    expect(snapshot.units).toEqual([]);
  });

  it("skips a unit whose numbers are unreadable and keeps the rest", () => {
    const html = fixture.replace("<TD>Shepard (EGC1)</TD><TD>868</TD>", "<TD>Shepard (EGC1)</TD><TD>n/a</TD>");
    const snapshot = parseCurrentSupplyDemand(html);
    expect(snapshot.units.find((unit) => unit.code === "EGC1")).toBeUndefined();
    expect(snapshot.units.find((unit) => unit.code === "CAL1")).toBeDefined();
  });

  it.each([
    ["an error page", "<html><body><h1>Service unavailable</h1></body></html>"],
    ["an empty string", ""],
    ["no time", fixture.replace(/Last Update/g, "Updated")],
    ["no load", fixture.replace(/Alberta Internal Load \(AIL\)/g, "Something")],
    ["a non-numeric load", fixture.replace(/<TD>10718<\/TD>/g, "<TD>n/a</TD>")],
    ["no generation", fixture.replace(/Alberta Total Net Generation/g, "Something")],
    ["no interchange", fixture.replace(/Net Actual Interchange/g, "Something")],
    ["a fuel with an unreadable output", fixture.replace(/(<TD>WIND<\/TD><TD>\d+<\/TD><TD>)\d+/i, "$1-")],
    ["a fuel with an unreadable capability", fixture.replace(/(<TD>WIND<\/TD><TD>)\d+/i, "$1-")],
    ["a fuel with a wrong output", fixture.replace(/(<TD>WIND<\/TD><TD>\d+<\/TD><TD>)\d+/i, "$10")],
  ])("rejects %s instead of guessing", (_name, html) => {
    expect(() => parseCurrentSupplyDemand(html)).toThrow(GridParseError);
  });
});

describe("parseReportTime", () => {
  it("rejects anything that is not a full report time", () => {
    expect(parseReportTime("Nov 07, 2026")).toBeNull();
    expect(parseReportTime("Foo 07, 2026 13:16")).toBeNull();
  });
});

describe("familyOf", () => {
  it.each([
    ["COGENERATION", "gas"],
    ["COMBINED CYCLE", "gas"],
    ["GAS FIRED STEAM", "gas"],
    ["SIMPLE CYCLE", "gas"],
    ["WIND", "wind"],
    ["SOLAR", "solar"],
    ["HYDRO", "hydro"],
    ["ENERGY STORAGE", "storage"],
    ["OTHER", "other"],
    ["BIOMASS AND OTHER", "other"],
  ])("files %s under %s", (name, family) => {
    expect(familyOf(name)).toBe(family);
  });
});
