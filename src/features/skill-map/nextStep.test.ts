import { describe, expect, it } from "vitest";
import type { NodeState } from "@/shared/types";
import { computeNextStep, type NextStepInput } from "./nextStep";
import type { UnitRailItem } from "./unitView";

const skills = (ids: string[]) => ids.map((id) => ({ id, title: id.toUpperCase() }));

function unit(n: number, nodeIds: string[], states: Record<string, NodeState>, extra: Partial<UnitRailItem> = {}): UnitRailItem {
  return {
    id: `u${n}`,
    number: n,
    title: `Unit ${n} title`,
    plannedTopics: nodeIds.length || 4,
    built: nodeIds.length > 0,
    nodeIds,
    topicTitles: [],
    proved: nodeIds.filter((id) => states[id] === "proven").length,
    status: nodeIds.length > 0 ? "built" : "ready",
    waitingFor: null,
    ...extra,
  };
}

const program = { id: "p1", title: "Program", courseNumber: 1, courseCount: 3 };

describe("computeNextStep", () => {
  it("1. suggests a skill the proof just unlocked", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "available", c: "available" };
    const step = computeNextStep({ skills: skills(["a", "b", "c"]), states, units: null, currentNodeId: "a", justUnlockedIds: ["c"] });
    expect(step).toMatchObject({ kind: "skill", nodeId: "c", reason: "unlocked" });
  });

  it("2. at a leaf (nothing unlocked) suggests another available skill in the unit, in map order", () => {
    const states: Record<string, NodeState> = { a: "available", b: "proven", c: "available" };
    const step = computeNextStep({ skills: skills(["a", "b", "c"]), states, units: null, currentNodeId: "b", justUnlockedIds: [] });
    expect(step).toMatchObject({ kind: "skill", nodeId: "a", reason: "unit" });
  });

  it("never suggests the skill that was just read or proven", () => {
    const states: Record<string, NodeState> = { a: "available", b: "available" };
    expect(computeNextStep({ skills: skills(["a", "b"]), states, units: null, currentNodeId: "a" })).toMatchObject({ nodeId: "b" });
  });

  it("works on a posting map with no units and a leaf node", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "proven", c: "locked" };
    const step = computeNextStep({
      skills: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C", prerequisites: ["a", "x"] }],
      states: { ...states, x: "available" },
      units: null,
      currentNodeId: "b",
    });
    // Nothing open: C is locked on a missing skill. It says what opens it.
    expect(step.kind).toBe("waiting");
  });

  it("3. offers the unit test when the unit is fully proved and its test is not passed", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "proven", c: "available" };
    const units = [unit(1, ["a", "b"], states), unit(2, ["c"], states)];
    const step = computeNextStep({ skills: skills(["a", "b", "c"]), states, units, unitTestsRequired: true, currentNodeId: "b" });
    expect(step).toEqual({ kind: "unit-test", unitId: "u1", unitTitle: "Unit 1 title" });
  });

  it("skips a unit test that is already passed", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "proven", c: "available" };
    const units = [unit(1, ["a", "b"], states), unit(2, ["c"], states)];
    const step = computeNextStep({
      skills: skills(["a", "b", "c"]), states, units, unitTestsRequired: true, passedUnitTests: new Set(["u1"]), currentNodeId: "b",
    });
    expect(step).toMatchObject({ kind: "skill", nodeId: "c", reason: "other-unit" });
  });

  it("4. offers to start the next unit when it can open", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "proven" };
    const units = [unit(1, ["a", "b"], states), unit(2, [], states, { status: "ready", plannedTopics: 4 })];
    const step = computeNextStep({ skills: skills(["a", "b"]), states, units, currentNodeId: "b" });
    expect(step).toEqual({ kind: "unit", unitId: "u2", unitTitle: "Unit 2 title", unitNumber: 2 });
  });

  it("5. falls to an available skill in another built unit", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "available", c: "proven" };
    const units = [unit(1, ["a", "b"], states), unit(2, ["c"], states)];
    // Working in unit 2 (fully proved, no tests): unit 1 still has B.
    const step = computeNextStep({ skills: skills(["a", "b", "c"]), states, units, currentNodeId: "c" });
    expect(step).toMatchObject({ kind: "skill", nodeId: "b", reason: "other-unit" });
  });

  it("5. points at another unit that owes its test before the final", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "proven", c: "proven" };
    const units = [unit(1, ["a"], states), unit(2, ["b", "c"], states)];
    const step = computeNextStep({
      skills: skills(["a", "b", "c"]), states, units, unitTestsRequired: true, passedUnitTests: new Set(["u2"]), currentNodeId: "c",
    });
    expect(step).toMatchObject({ kind: "unit-test", unitId: "u1" });
  });

  it("6. offers the course final when every topic is proved and it is not passed", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "proven" };
    const step = computeNextStep({ skills: skills(["a", "b"]), states, units: null, currentNodeId: "b" });
    expect(step).toEqual({ kind: "final" });
  });

  it("does not offer the final while later units are not built", () => {
    const states: Record<string, NodeState> = { a: "proven" };
    const units = [unit(1, ["a"], states), unit(2, [], states, { status: "locked", waitingFor: { unitNumber: 1, needed: 2, proved: 1 } })];
    const step = computeNextStep({ skills: skills(["a"]), states, units, currentNodeId: "a" });
    expect(step).toMatchObject({ kind: "waiting" });
    expect((step as { message: string }).message).toContain("Prove 1 more topic in Unit 1 to open Unit 2");
  });

  it("7. a finished program course links back to the program page", () => {
    const states: Record<string, NodeState> = { a: "proven" };
    const step = computeNextStep({ skills: skills(["a"]), states, units: null, finalPassed: true, program, currentNodeId: "a" });
    expect(step).toEqual({ kind: "program", programId: "p1", programTitle: "Program", href: "/program/p1", nextCourseNumber: 2 });
  });

  it("7. the last course of a program has no next course number", () => {
    const states: Record<string, NodeState> = { a: "proven" };
    const step = computeNextStep({
      skills: skills(["a"]), states, units: null, finalPassed: true, program: { ...program, courseNumber: 3 }, currentNodeId: "a",
    });
    expect(step).toMatchObject({ kind: "program", nextCourseNumber: null });
  });

  it("7. a fully finished standalone course says so and links to the dashboard", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "proven" };
    const step = computeNextStep({ skills: skills(["a", "b"]), states, units: null, finalPassed: true, currentNodeId: "b" });
    expect(step).toEqual({ kind: "finished", href: "/dashboard" });
  });

  it("never offers the final while the syllabus is still planning", () => {
    const states: Record<string, NodeState> = { a: "proven" };
    const step = computeNextStep({ skills: skills(["a"]), states, units: null, planning: true, currentNodeId: "a" });
    expect(step.kind).toBe("waiting");
    expect((step as { message: string }).message).toContain("planned");
  });

  it("an empty map waits instead of finishing", () => {
    const step = computeNextStep({ skills: [], states: {}, units: null });
    expect(step.kind).toBe("waiting");
  });

  it("names the unproven skills that would open a locked one", () => {
    const states: Record<string, NodeState> = { a: "proven", b: "locked", c: "locked" };
    const input: NextStepInput = {
      skills: [{ id: "a", title: "A" }, { id: "b", title: "B", prerequisites: ["a", "c"] }, { id: "c", title: "C" }],
      states,
      units: null,
      currentNodeId: "a",
    };
    expect((computeNextStep(input) as { message: string }).message).toBe("B opens once C is proven.");
  });

  it("with no current skill it starts in the unit being viewed", () => {
    const states: Record<string, NodeState> = { a: "available", b: "available" };
    const units = [unit(1, ["a"], states), unit(2, ["b"], states)];
    expect(computeNextStep({ skills: skills(["a", "b"]), states, units, currentUnitId: "u2" })).toMatchObject({ nodeId: "b", reason: "unit" });
  });
});
