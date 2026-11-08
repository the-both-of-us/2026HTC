import { describe, expect, it } from "vitest";
import type { SkillNode } from "@/shared/types";
import { deriveNodeStates, unlockedEarlyIds } from "./states";

function node(id: string, prerequisites: string[] = []): SkillNode {
  return { id, title: id, why: "", prerequisites, fromSource: false, citation: null, checkpoints: [] };
}

const map = { nodes: [node("a"), node("b", ["a"]), node("c", ["a", "b"]), node("d")] };

describe("deriveNodeStates", () => {
  it("opens only the roots when nothing is proven", () => {
    expect(deriveNodeStates(map, null)).toEqual({ a: "available", b: "locked", c: "locked", d: "available" });
  });
  it("opens a node once its prerequisite is proven", () => {
    expect(deriveNodeStates(map, { proven: { a: "attempt-1" } })).toEqual({
      a: "proven",
      b: "available",
      c: "locked",
      d: "available",
    });
  });
  it("needs all prerequisites before opening", () => {
    expect(deriveNodeStates(map, { proven: { a: "x", b: "y" } }).c).toBe("available");
    expect(deriveNodeStates(map, { proven: { b: "y" } }).c).toBe("locked");
  });
  it("keeps a proven node proven, even if its prerequisite is not", () => {
    expect(deriveNodeStates(map, { proven: { b: "y" } }).b).toBe("proven");
  });
  it("ignores progress for nodes that are not on the map", () => {
    expect(Object.keys(deriveNodeStates(map, { proven: { gone: "z" } }))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("unlocked anyway", () => {
  it("opens a locked node without its prerequisites, and proven still wins", () => {
    expect(deriveNodeStates(map, { proven: {}, unlocked: { c: "2026-11-07T00:00:00.000Z" } }).c).toBe("available");
    expect(deriveNodeStates(map, { proven: { c: "x" }, unlocked: { c: "t" } }).c).toBe("proven");
  });

  it("marks a node unlocked early only while its prerequisites are not all proven", () => {
    expect([...unlockedEarlyIds(map, { proven: {}, unlocked: { c: "t" } })]).toEqual(["c"]);
    expect([...unlockedEarlyIds(map, { proven: { a: "x", b: "y" }, unlocked: { c: "t" } })]).toEqual([]);
    expect([...unlockedEarlyIds(map, null)]).toEqual([]);
  });
});
