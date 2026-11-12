import { describe, expect, it } from "vitest";
import { buildTarget, destinationOf } from "./request";

describe("buildTarget", () => {
  it("sends a posting to one private map whatever the size says", () => {
    expect(buildTarget("posting", "text", "program")).toEqual({ url: "/api/maps", body: { text: "text", kind: "posting" } });
  });
  it("sends one course straight to the map route", () => {
    expect(buildTarget("topic", "SQL", "course")).toEqual({ url: "/api/maps", body: { text: "SQL", kind: "topic" } });
  });
  it("sends a program or an undecided topic to the programs route", () => {
    expect(buildTarget("topic", "Psychology", "program").body).toEqual({ text: "Psychology", kind: "topic", shape: "program" });
    expect(buildTarget("topic", "Psychology", "auto")).toEqual({ url: "/api/programs", body: { text: "Psychology", kind: "topic", shape: "auto" } });
  });
});

describe("destinationOf", () => {
  it("reads programId, mapId and id", () => {
    expect(destinationOf({ programId: "p1" })).toBe("/program/p1");
    expect(destinationOf({ mapId: "m1" })).toBe("/map/m1");
    expect(destinationOf({ id: "m2" })).toBe("/map/m2");
    expect(destinationOf({ error: "x" })).toBeNull();
    expect(destinationOf(null)).toBeNull();
  });
});
