import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NodeState, PublicSkillNode } from "@/shared/types";
import type { UnitRailItem } from "../unitView";
import { SkillList } from "./SkillList";
import { UnitRail } from "./UnitRail";

vi.mock("./unitApi", () => ({ startUnit: async () => ({ kind: "building" }) }));

const node = (id: string, title: string): PublicSkillNode =>
  ({ id, title, why: "Why it matters.", prerequisites: [], fromSource: false, citation: null, checkpointCount: 2 }) as unknown as PublicSkillNode;

describe("the Known (pre-test) mark", () => {
  const skills = [node("a", "Latency"), node("b", "Throughput")];
  const states: Record<string, NodeState> = { a: "proven", b: "proven" };

  it("marks only pre-test passes in the All Skills list, worded as a pre-test pass", () => {
    const html = renderToStaticMarkup(
      <SkillList skills={skills} states={states} selectedId={null} sourceKind="topic" onSelect={() => {}} knownIds={new Set(["a"])} />,
    );
    expect(html.match(/Known \(pre-test\)/g)).toHaveLength(1);
    expect(html).toContain("Known: passed a pre-test question");
    // The explained skill carries no mark.
    expect(html.indexOf("Latency")).toBeLessThan(html.indexOf("Known (pre-test)"));
    expect(html.indexOf("Known (pre-test)")).toBeLessThan(html.indexOf("Throughput"));
  });

  it("shows no mark when nothing was passed by pre-test", () => {
    const html = renderToStaticMarkup(
      <SkillList skills={skills} states={states} selectedId={null} sourceKind="topic" onSelect={() => {}} />,
    );
    expect(html).not.toContain("pre-test");
  });

  it("counts known topics on built and unbuilt units of the rail", () => {
    const unit = (n: number, built: boolean): UnitRailItem => ({
      id: `u${n}`,
      number: n,
      title: `Unit ${n} title`,
      plannedTopics: 4,
      built,
      nodeIds: built ? ["a", "b", "c", "d"] : [],
      topicTitles: [],
      proved: built ? 2 : 1,
      status: built ? "built" : "ready",
      waitingFor: null,
    });
    const html = renderToStaticMarkup(
      <UnitRail units={[unit(1, true), unit(2, false)]} selectedId="u1" onSelect={() => {}} knownCounts={{ u1: 2, u2: 1 }} />,
    );
    expect(html).toContain("2 known");
    expect(html).toContain("1 known");
    expect(html).toContain("1 topic known from the pre-test");
    expect(html).toContain("2 topics known from the pre-test");
  });
});
