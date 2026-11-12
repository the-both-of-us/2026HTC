import { describe, expect, it } from "vitest";
import type { CourseSyllabus, SkillMap, SkillNode } from "@/shared/types";
import { skillBlock, unitOfNode } from "./skillBlock";
import { initialUnitId, plannedTopicTotal, unitRail, unitStartRule } from "./unitView";

const LEGACY_NODE: SkillNode = {
  id: "what-is-psych",
  title: "What psychology studies",
  why: "Every later topic builds on it.",
  prerequisites: [],
  fromSource: false,
  citation: null,
  checkpoints: ["One fact.", "Two facts.", "Three facts."],
};

const SYLLABUS: CourseSyllabus = {
  version: 1,
  courseSlug: "intro",
  outcomes: [
    { id: "o1", text: "Describe the science of behaviour" },
    { id: "o2", text: "Explain how <skill>neurons</skill> communicate" },
  ],
  units: [
    {
      id: "u1",
      title: "Survey",
      outcomeIds: ["o1"],
      built: true,
      topics: [
        {
          id: "what-is-psych",
          title: "What psychology studies",
          objectives: ["Define psychology"],
          keyTerms: ["behaviour", "mind", "empiricism"],
          inScope: "What the field studies.",
          outOfScope: "Its history.",
          buildsOn: [],
        },
      ],
    },
    {
      id: "u2",
      title: "Biological bases",
      outcomeIds: ["o2"],
      built: false,
      topics: ["neurons", "synapses", "hormones", "brain"].map((id) => ({
        id,
        title: id,
        objectives: ["a", "b"],
        keyTerms: ["x", "y", "z"],
        inScope: "in",
        outOfScope: "out",
        buildsOn: [],
      })),
    },
  ],
  assessment: { unitTests: true, finalQuestions: 6 },
};

/** The lesson prompt's block, as lessons/prompt.ts writes it, with the syllabus lines spread in. */
function lessonBlock(map: Pick<SkillMap, "title" | "syllabus">, node: SkillNode): string {
  return [
    "<skill>",
    `Course: ${map.title}`,
    `Skill: ${node.title}`,
    `Why it matters: ${node.why}`,
    ...skillBlock(map, node),
    "Checkpoints:",
    node.checkpoints.map((checkpoint, index) => `${index + 1}. ${checkpoint}`).join("\n"),
    "</skill>",
  ].join("\n");
}

describe("skillBlock", () => {
  it("adds nothing for a node built before syllabi, so the old block is byte for byte the same", () => {
    expect(skillBlock({}, LEGACY_NODE)).toEqual([]);
    expect(skillBlock({ syllabus: undefined }, LEGACY_NODE)).toEqual([]);
    const old = [
      "<skill>",
      "Course: Intro",
      "Skill: What psychology studies",
      "Why it matters: Every later topic builds on it.",
      "Checkpoints:",
      "1. One fact.\n2. Two facts.\n3. Three facts.",
      "</skill>",
    ].join("\n");
    expect(lessonBlock({ title: "Intro" }, LEGACY_NODE)).toBe(old);
  });

  it("adds the unit, its outcomes, objectives, key terms and scope when the node has them", () => {
    const node: SkillNode = {
      ...LEGACY_NODE,
      id: "neurons",
      unitId: "u2",
      topicId: "neurons",
      objectives: ["Describe an action potential", "Name the parts of a neuron"],
      keyTerms: ["axon", "dendrite", "myelin"],
      inScope: "How one neuron fires.",
      outOfScope: "Hormones, which a later topic covers.",
    };
    expect(skillBlock({ syllabus: SYLLABUS }, node)).toEqual([
      "Unit: Biological bases",
      "Unit outcomes:",
      "- Explain how neurons communicate",
      "Objectives:",
      "- Describe an action potential",
      "- Name the parts of a neuron",
      "Key terms: axon, dendrite, myelin",
      "Covers: How one neuron fires.",
      "Leaves out: Hormones, which a later topic covers.",
    ]);
  });

  it("gives an older node the fields of its topic once its course has a syllabus (deepened in place)", () => {
    const lines = skillBlock({ syllabus: SYLLABUS }, LEGACY_NODE, (text) => text.toUpperCase());
    expect(lines).toEqual([
      "Unit: SURVEY",
      "Unit outcomes:",
      "- DESCRIBE THE SCIENCE OF BEHAVIOUR",
      "Objectives:",
      "- DEFINE PSYCHOLOGY",
      "Key terms: BEHAVIOUR, MIND, EMPIRICISM",
      "Covers: WHAT THE FIELD STUDIES.",
      "Leaves out: ITS HISTORY.",
    ]);
  });

  it("finds a node's unit by unitId, else by topic", () => {
    expect(unitOfNode(SYLLABUS, { id: "x", unitId: "u2" })?.id).toBe("u2");
    expect(unitOfNode(SYLLABUS, { id: "what-is-psych" })?.id).toBe("u1");
    expect(unitOfNode(SYLLABUS, { id: "nowhere" })).toBeUndefined();
    expect(unitOfNode(undefined, { id: "what-is-psych" })).toBeUndefined();
  });
});

describe("unitRail", () => {
  it("counts planned topics, proofs per unit, and opens unit k+1 once half of unit k is proved", () => {
    const nodes = [{ id: "what-is-psych" }, { id: "stray" }];
    const locked = unitRail(SYLLABUS, nodes, {});
    expect(locked.map((unit) => [unit.id, unit.status, unit.plannedTopics, unit.proved])).toEqual([
      ["u1", "built", 2, 0],
      ["u2", "locked", 4, 0],
    ]);
    expect(locked[1].waitingFor).toEqual({ unitNumber: 1, needed: 1, proved: 0 });
    expect(plannedTopicTotal(locked)).toBe(6);

    const open = unitRail(SYLLABUS, nodes, { "what-is-psych": "proven" });
    expect(open[1].status).toBe("ready");
    expect(open[1].topicTitles).toEqual(["neurons", "synapses", "hormones", "brain"]);
    expect(unitStartRule(5)).toBe(3);
  });

  it("opens on the unit of a linked skill, else the first built unit with work left", () => {
    const rail = unitRail(SYLLABUS, [{ id: "what-is-psych" }], {});
    expect(initialUnitId(rail, "what-is-psych")).toBe("u1");
    expect(initialUnitId(rail, null)).toBe("u1");
  });
});
