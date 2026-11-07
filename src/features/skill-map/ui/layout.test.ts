import { describe, expect, it } from "vitest";
import { edgePath, layoutGraph, NODE_WIDTH, type LayoutInput } from "./layout";

const node = (id: string, ...prerequisites: string[]): LayoutInput => ({ id, prerequisites });

function byId(input: LayoutInput[]) {
  const layout = layoutGraph(input);
  return { layout, get: (id: string) => layout.nodes.find((n) => n.id === id)! };
}

describe("layoutGraph", () => {
  it("places every node once", () => {
    const input = [node("a"), node("b", "a"), node("c", "a"), node("d", "b", "c"), node("alone")];
    const { layout } = byId(input);
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(["a", "alone", "b", "c", "d"]);
  });

  it("puts a node one row below its furthest prerequisite", () => {
    const { get } = byId([node("a"), node("b", "a"), node("c", "b"), node("d", "c", "b")]);
    expect([get("a").layer, get("b").layer, get("c").layer, get("d").layer]).toEqual([0, 1, 2, 3]);
  });

  it("slides a starting node down, next to the skill it leads to", () => {
    const { get } = byId([node("a"), node("b", "a"), node("c", "b"), node("late"), node("d", "c", "late")]);
    expect(get("late").layer).toBe(get("d").layer - 1);
  });

  it("hides a line another path already implies", () => {
    const { layout } = byId([node("a"), node("b", "a"), node("c", "a", "b")]);
    expect(layout.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(["a>b", "b>c"]);
  });

  it("routes a line that skips rows through a straight run in each row", () => {
    const { layout, get } = byId([
      node("a"),
      node("b", "a"),
      node("c", "b"),
      node("x"),
      node("y", "x"),
      node("z", "y", "a"),
    ]);
    const long = layout.edges.find((e) => e.from === "a" && e.to === "z")!;
    expect(get("z").layer - get("a").layer).toBeGreaterThan(1);
    expect(long.waypoints.length).toBe(2 * (get("z").layer - get("a").layer - 1));
  });

  it("never overlaps two nodes in a row", () => {
    const input = [
      node("a"),
      node("b"),
      node("c", "a"),
      node("d", "a", "b"),
      node("e", "b"),
      node("f", "c", "d"),
      node("g", "d", "e"),
      node("h", "f", "g"),
    ];
    const { layout } = byId(input);
    for (const first of layout.nodes) {
      for (const second of layout.nodes) {
        if (first.id === second.id || first.layer !== second.layer) continue;
        expect(Math.abs(first.x - second.x)).toBeGreaterThanOrEqual(NODE_WIDTH);
      }
    }
  });

  it("untangles crossings the input order would cause", () => {
    // Input order pairs a with the lower child and b with the upper one.
    const { get } = byId([node("a"), node("b"), node("low", "b"), node("high", "a")]);
    const sameOrder = get("a").x < get("b").x === get("high").x < get("low").x;
    expect(sameOrder).toBe(true);
  });

  it("keeps unconnected groups close together, largest first", () => {
    const { layout, get } = byId([
      node("small-a"),
      node("small-b", "small-a"),
      node("big-a"),
      node("big-b", "big-a"),
      node("big-c", "big-b"),
    ]);
    expect(get("big-a").x).toBeLessThan(get("small-a").x);
    const furthest = Math.max(...layout.nodes.map((n) => n.x));
    // One node plus the gap between the groups, and no more.
    expect(furthest).toBeLessThan(2 * NODE_WIDTH);
  });

  it("gives the same result every time", () => {
    const input = [node("a"), node("b", "a"), node("c", "a"), node("d", "b", "c")];
    expect(layoutGraph(input)).toEqual(layoutGraph(input));
  });

  it("lists nodes row by row, for the keyboard's Tab order", () => {
    const { layout } = byId([node("c", "b"), node("b", "a"), node("a")]);
    expect(layout.nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("survives a cycle and an unknown prerequisite", () => {
    const { layout } = byId([node("a", "b"), node("b", "a"), node("c", "missing")]);
    expect(layout.nodes).toHaveLength(3);
  });

  it("returns nothing for an empty map", () => {
    expect(layoutGraph([])).toEqual({ nodes: [], edges: [] });
  });
});

describe("edgePath", () => {
  it("starts and ends at the given points", () => {
    const path = edgePath({ x: 0, y: 0 }, [], { x: 100, y: 50 });
    expect(path).toBe("M 0 0 C 0 25, 100 25, 100 50");
  });
});
