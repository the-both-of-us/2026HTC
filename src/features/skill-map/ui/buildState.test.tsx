import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PublicSkillMap } from "../storage";
import type { UnitRailItem } from "../unitView";
import { BuildPanel } from "./BuildPanel";
import { canvasWait, needsMapPoll } from "./buildState";
import { UnitRail } from "./UnitRail";

vi.mock("./unitApi", () => ({ startUnit: async () => ({ kind: "building" }) }));

type Shape = Pick<PublicSkillMap, "build" | "nodes" | "syllabus">;
const syllabus = (units: number, planning: boolean) =>
  ({ units: Array.from({ length: units }, (_, i) => ({ id: `u${i + 1}` })), planning }) as unknown as PublicSkillMap["syllabus"];
const map = (build: Shape["build"], units: number, nodes = 0, planning = false): Shape => ({
  build,
  nodes: Array.from({ length: nodes }, () => ({})) as unknown as Shape["nodes"],
  syllabus: syllabus(units, planning),
});

describe("canvasWait", () => {
  it("waits for the syllabus while no unit is planned", () => {
    expect(canvasWait(map({ syllabus: "running", unit1: "idle" }, 0, 0, true))).toBe("syllabus");
  });
  it("waits for unit 1 once it is planned, or the syllabus is final", () => {
    expect(canvasWait(map({ syllabus: "running", unit1: "running" }, 1, 0, true))).toBe("unit1");
    expect(canvasWait(map({ syllabus: "ready", unit1: "running" }, 8))).toBe("unit1");
    // Unit 1 is on the server and the next read copies it in.
    expect(canvasWait(map({ syllabus: "ready", unit1: "ready" }, 8))).toBe("unit1");
  });
  it("reports a dead writer as failed", () => {
    expect(canvasWait(map({ syllabus: "idle", unit1: "idle" }, 0))).toBe("failed-syllabus");
    expect(canvasWait(map({ syllabus: "ready", unit1: "idle" }, 8))).toBe("failed-unit1");
  });
  it("shows the graph once there are nodes, and for maps with no build state", () => {
    expect(canvasWait(map({ syllabus: "running", unit1: "ready" }, 3, 5, true))).toBeNull();
    expect(canvasWait(map(undefined, 0))).toBeNull();
  });
});

describe("needsMapPoll", () => {
  it("polls while anything runs, even with nodes (the rail is filling in)", () => {
    expect(needsMapPoll(map({ syllabus: "running", unit1: "ready" }, 3, 5, true))).toBe(true);
    expect(needsMapPoll(map({ syllabus: "ready", unit1: "running" }, 8))).toBe(true);
  });
  it("stops when ready or failed, and never polls an older map", () => {
    expect(needsMapPoll(map({ syllabus: "ready", unit1: "ready" }, 8, 5))).toBe(false);
    expect(needsMapPoll(map({ syllabus: "idle", unit1: "idle" }, 0))).toBe(false);
    expect(needsMapPoll(map({ syllabus: "ready", unit1: "idle" }, 8))).toBe(false);
    expect(needsMapPoll(map(undefined, 0))).toBe(false);
  });
});

describe("BuildPanel and the planning rail", () => {
  it("says Unit 1 is being written", () => {
    const html = renderToStaticMarkup(<BuildPanel mapId="m" wait="unit1" isOwner onRestarted={() => {}} />);
    expect(html).toContain("Unit 1 is being written. It usually takes under a minute.");
  });
  it("offers Try again to the owner of a failed build and no one else", () => {
    expect(renderToStaticMarkup(<BuildPanel mapId="m" wait="failed-syllabus" isOwner onRestarted={() => {}} />)).toContain("Try again");
    expect(renderToStaticMarkup(<BuildPanel mapId="m" wait="failed-unit1" isOwner={false} onRestarted={() => {}} />)).not.toContain("Try again");
  });
  it("shows the planning pill beside the units so far", () => {
    const unit: UnitRailItem = { id: "u1", number: 1, title: "Survey", plannedTopics: 5, built: false, nodeIds: [], topicTitles: [], proved: 0, status: "ready", waitingFor: null };
    const html = renderToStaticMarkup(<UnitRail units={[unit]} selectedId="u1" onSelect={() => {}} planning />);
    expect(html).toContain("Survey");
    expect(html).toContain("Planning more units");
    expect(renderToStaticMarkup(<UnitRail units={[]} selectedId={null} onSelect={() => {}} planning />)).toContain("Planning units");
  });
});
