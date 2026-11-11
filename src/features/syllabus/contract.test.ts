import { describe, expect, expectTypeOf, it } from "vitest";
import { toPublicMap } from "@/features/skill-map";
import type { CourseView, Program, ProgramView } from "@/features/programs";
import {
  DEGREE_FRAME,
  READING_WORDS_PER_MINUTE,
  SYLLABUS_SHAPE,
  UNIT_TEST,
  unitTestNodeId,
  type CourseSyllabus,
  type SkillMap,
  type SkillNode,
} from "@/shared/types";

/*
 * The WP0 contract: every field added for syllabi and degree programs is optional, so documents
 * stored before them still type-check, parse and read exactly as before.
 */

// Written as the store held them before syllabi: no field added since.
const OLD_NODE_JSON = `{"id":"what-is-psychology","title":"What psychology studies","why":"Every later topic builds on it.","prerequisites":[],"fromSource":false,"citation":null,"checkpoints":["Psychology is the scientific study of mind and behaviour","It uses empirical methods","It has many subfields"]}`;
const OLD_MAP_JSON = `{"id":"4b0c3c2e-1f5e-4c55-9f7e-0d1f6c3a2b10","ownerId":"owner-1","title":"Introduction to Psychology","subtitle":"","sourceKind":"topic","sourceText":"psychology","nodes":[${OLD_NODE_JSON}],"createdAt":"2026-11-01T00:00:00.000Z","program":{"id":"p1","title":"Psychology","courseNumber":1,"courseCount":6,"unlocks":["Research Methods"]}}`;
const OLD_PROGRAM_JSON = `{"id":"p1","ownerId":"owner-1","title":"Psychology","summary":"A path into psychology.","sourceKind":"topic","sourceText":"psychology","courses":[{"slug":"intro-psych","title":"Introduction to Psychology","summary":"Know the field.","requires":[],"mapId":"4b0c3c2e-1f5e-4c55-9f7e-0d1f6c3a2b10"},{"slug":"research-methods","title":"Research Methods","summary":"Read a study.","requires":["intro-psych"]}],"createdAt":"2026-11-01T00:00:00.000Z"}`;

describe("old documents under the new contract", () => {
  it("type-checks an old node, map and program written as literals", () => {
    const node: SkillNode = {
      id: "what-is-psychology",
      title: "What psychology studies",
      why: "Every later topic builds on it.",
      prerequisites: [],
      fromSource: false,
      citation: null,
      checkpoints: ["a", "b", "c"],
    };
    const map: SkillMap = {
      id: "m1",
      ownerId: "owner-1",
      title: "Introduction to Psychology",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "psychology",
      nodes: [node],
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    const program: Program = {
      id: "p1",
      ownerId: "owner-1",
      title: "Psychology",
      summary: "",
      sourceKind: "topic",
      sourceText: "psychology",
      courses: [{ slug: "intro-psych", title: "Intro", summary: "", requires: [] }],
      createdAt: "2026-11-01T00:00:00.000Z",
    };
    const view: CourseView = {
      slug: "intro-psych",
      number: 1,
      title: "Intro",
      summary: "",
      mapId: null,
      proven: 0,
      total: null,
      state: "open",
      badge: false,
      blockers: [],
    };
    const programView: ProgramView = {
      id: "p1",
      title: "Psychology",
      summary: "",
      sourceKind: "topic",
      isSample: false,
      courses: [view],
    };
    expect([node, map, program, view, programView]).toHaveLength(5);
  });

  it("parses stored JSON with every new field absent, meaning today's behaviour", () => {
    const node = JSON.parse(OLD_NODE_JSON) as SkillNode;
    const map = JSON.parse(OLD_MAP_JSON) as SkillMap;
    const program = JSON.parse(OLD_PROGRAM_JSON) as Program;

    for (const field of ["unitId", "topicId", "objectives", "keyTerms", "inScope", "outOfScope"] as const) {
      expect(node[field]).toBeUndefined();
    }
    expect(map.syllabus).toBeUndefined();
    expect(program.depth).toBeUndefined();
    expect(program.deepenedAt).toBeUndefined();
    for (const course of program.courses) {
      expect(course.year).toBeUndefined();
      expect(course.term).toBeUndefined();
      expect(course.level).toBeUndefined();
      expect(course.area).toBeUndefined();
      expect(course.hasSyllabus).toBeUndefined();
    }
  });

  it("gives an old map the same public shape as before", () => {
    const map = JSON.parse(OLD_MAP_JSON) as SkillMap;
    const pub = toPublicMap(map);
    expect(Object.keys(pub).sort()).toEqual(
      ["createdAt", "energyRelated", "id", "nodes", "program", "sourceKind", "subtitle", "title"].sort(),
    );
    expect(Object.keys(pub.nodes[0]).sort()).toEqual(
      ["checkpointCount", "citation", "fromSource", "id", "prerequisites", "title", "why"].sort(),
    );
  });
});

describe("syllabus shape", () => {
  it("accepts a degree syllabus and copies it with the map", () => {
    const syllabus: CourseSyllabus = {
      version: 1,
      rootMapId: "m1",
      depth: "degree",
      courseSlug: "intro-psych",
      level: 100,
      outcomes: [{ id: "o1", text: "Describe what psychology studies." }],
      units: [
        {
          id: "u1",
          title: "Survey",
          outcomeIds: ["o1"],
          built: true,
          topics: [
            {
              id: "what-is-psychology",
              title: "What psychology studies",
              objectives: ["Define psychology", "Name three subfields"],
              keyTerms: ["behaviour", "mind", "empirical"],
              inScope: "What the field studies and how.",
              outOfScope: "Research design, taught in Research Methods.",
              buildsOn: [],
            },
          ],
        },
      ],
      assessment: { unitTests: true, finalQuestions: SYLLABUS_SHAPE.degree.finalQuestions },
    };
    const map = { ...(JSON.parse(OLD_MAP_JSON) as SkillMap), syllabus };
    const copy: SkillMap = JSON.parse(JSON.stringify({ ...map, id: "m2", forkedFrom: map.id }));
    expect(copy.syllabus).toEqual(syllabus);
    expect(copy.syllabus?.rootMapId).toBe("m1");
  });

  it("matches the owner's decisions", () => {
    const { degree, quick } = SYLLABUS_SHAPE;
    expect(degree.units * degree.topicsPerUnit.min).toBe(32);
    expect(degree.units * degree.topicsPerUnit.max).toBe(48);
    expect(quick.units).toBe(1);
    expect([quick.topicsPerUnit.min, quick.topicsPerUnit.max]).toEqual([6, 10]);
    expect([degree.finalQuestions, degree.finalPassMark]).toEqual([6, 4]);
    expect([UNIT_TEST.questions, UNIT_TEST.passMark]).toEqual([4, 3]);
    expect(DEGREE_FRAME.years * DEGREE_FRAME.termsPerYear * DEGREE_FRAME.coursesPerTerm).toBe(DEGREE_FRAME.courses);
    expect(READING_WORDS_PER_MINUTE).toBe(200);
    expect(unitTestNodeId("u2")).toBe("final:u2");
  });

  it("keeps every new field optional", () => {
    expectTypeOf<SkillNode["objectives"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<SkillMap["syllabus"]>().toEqualTypeOf<CourseSyllabus | undefined>();
  });
});
