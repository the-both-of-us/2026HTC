import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NOT_EQUIVALENT, type ComparisonView, type CourseView, type ProgramView, type SyllabusView } from "../types";
import { ComparePanel, ComparisonBody } from "./ComparePanel";
import { formatHours, groupByTerm } from "./format";
import { planningLine, needsProgramPoll } from "./planning";
import { ProgramScreen } from "./ProgramScreen";
import { startPromise } from "./StartCourse";
import { SyllabusDocument, syllabusIsPlanning, type LiveSyllabusView } from "./SyllabusScreen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const base = { summary: "s", blockers: [] as CourseView["blockers"], badge: false };
const legacyCourses: CourseView[] = [
  { ...base, slug: "a", number: 1, title: "Intro", mapId: "m1", proven: 3, total: 8, state: "open" },
  { ...base, slug: "b", number: 2, title: "Second", mapId: null, proven: 0, total: null, state: "open" },
];
const legacy: ProgramView = { id: "p1", title: "Psychology", summary: "", sourceKind: "topic", isSample: false, courses: legacyCourses };

const hours = {
  planned: { kind: "planned", hours: 4.5, label: "planned", basis: "b" },
  written: { kind: "written", hours: null, label: "written", basis: "b" },
  measured: { kind: "measured", hours: 1.2, label: "measured", basis: "b" },
} as const;

const degreeCourses: CourseView[] = [
  {
    ...base, slug: "a", number: 1, title: "Intro", mapId: "m1", proven: 3, total: 5, state: "open", year: 1, term: 1, level: 100, area: "Core",
    plannedTopics: 40, hasSyllabus: true,
    units: [
      { id: "u1", number: 1, title: "Survey", plannedTopics: 5, built: true, proved: 3, state: "open", test: "locked" },
      { id: "u2", number: 2, title: "Methods", plannedTopics: 5, built: false, proved: 0, state: "locked", test: "locked" },
    ],
    final: "locked",
  },
  { ...base, slug: "b", number: 2, title: "Second", mapId: null, proven: 0, total: null, state: "locked", year: 1, term: 2, level: 100, blockers: [{ title: "Intro", needed: 7 }] },
];
const degree: ProgramView = { ...legacy, depth: "degree", courses: degreeCourses, hours: { ...hours } };

describe("ProgramScreen", () => {
  it("renders a legacy view as it always did", () => {
    const html = renderToStaticMarkup(<ProgramScreen program={legacy} />);
    expect(html).toContain("Program · 2 courses");
    expect(html).toContain("3 of 8 topics proved");
    expect(html).toContain("8 units of 4 to 6 topics");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Deepen to degree");
    expect(html).not.toContain("Not equivalent");
    expect(html).not.toContain("Read the syllabus");
  });

  it("renders a degree view with terms, unit progress and computed counts", () => {
    const html = renderToStaticMarkup(<ProgramScreen program={degree} />);
    expect(html).toContain("Year 1, term 1");
    expect(html).toContain("Year 1, term 2");
    expect(html).toContain("3 of 40 topics proved");
    expect(html).toContain("0 of 1 course finished".replace("1 course", "1 course"));
    expect(html).toContain("Units: 0 of 2 done");
    expect(html).toContain("Read the syllabus");
    expect(html).toContain("4.5 h planned");
    expect(html).toContain("none written yet");
    expect(html).not.toContain("6 to 10 topics");
    expect(html).toContain("Not equivalent");
  });

  it("has no Deepen button any more", () => {
    expect(renderToStaticMarkup(<ProgramScreen program={degree} />)).not.toContain("Deepen");
  });

  it("shows a planning program: the real count, cards by term, Start only on registered courses", () => {
    const planning: ProgramView = {
      ...degree,
      planning: { state: "planning", planned: 2, expected: 40 },
      courses: [
        { ...degreeCourses[0], startable: true },
        { ...degreeCourses[1], state: "open", blockers: [], startable: false },
      ],
    };
    const html = renderToStaticMarkup(<ProgramScreen program={planning} />);
    expect(html).toContain("Planning courses: 2 of 40");
    expect(html).toContain("Program · planning");
    expect(html).toContain("Year 1, term 2");
    // The registering course's button is off and says so.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Planning/);
    expect(html).toContain("still being named");
  });

  it("shows a stalled program with Try again and no spinner line", () => {
    const html = renderToStaticMarkup(<ProgramScreen program={{ ...degree, planning: { state: "stalled", planned: 12, expected: 40 } }} />);
    expect(html).toContain("Planning stopped at 12 courses.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Planning courses:");
  });

  it("names a program before its head line arrives", () => {
    const html = renderToStaticMarkup(<ProgramScreen program={{ ...degree, title: "", summary: "", courses: [], planning: { state: "planning", planned: 0, expected: 40 } }} />);
    expect(html).toContain("Naming your program");
    expect(html).toContain("Planning courses: 0 of 40");
  });

  it("states a computed topic count on a degree course with a plan, and the shape without one", () => {
    expect(startPromise({ ...legacyCourses[1], plannedTopics: 36, units: new Array(8).fill(0).map((_, i) => ({ id: `u${i}`, number: i + 1, title: "t", plannedTopics: 4, built: false, proved: 0, state: "open", test: null })) }, "degree")).toBe(
      "36 topics in 8 units, planned.",
    );
    expect(startPromise(legacyCourses[1], "degree")).toContain("8 units of 4 to 6 topics");
    expect(startPromise(legacyCourses[1], undefined)).toContain("8 units of 4 to 6 topics");
  });

  it("decides when to poll", () => {
    const plan = (state: "planning" | "ready" | "stalled") => ({ state, planned: 1, expected: 40 as const });
    expect(needsProgramPoll({ courses: degreeCourses, planning: plan("planning") })).toBe(true);
    expect(needsProgramPoll({ courses: degreeCourses, planning: plan("stalled") })).toBe(false);
    expect(needsProgramPoll({ courses: degreeCourses, planning: plan("ready") })).toBe(false);
    expect(needsProgramPoll({ courses: [{ ...degreeCourses[0], startable: false }], planning: plan("ready") })).toBe(true);
    expect(needsProgramPoll({ courses: [{ ...degreeCourses[0], startable: false }], planning: plan("stalled") })).toBe(false);
    expect(needsProgramPoll({ courses: degreeCourses })).toBe(false);
    expect(planningLine({ planned: 5, expected: null })).toBe("Planning courses: 5 so far");
  });
});

describe("format", () => {
  it("groups by term in order and formats ranges", () => {
    expect(groupByTerm([...degreeCourses].reverse()).map((g) => g.label)).toEqual(["Year 1, term 1", "Year 1, term 2"]);
    expect(formatHours({ kind: "planned", hours: 4, hoursMax: 6, label: "planned", basis: "" })).toBe("4 to 6 h planned");
  });
});

const comparison: ComparisonView = {
  programId: "p1", programTitle: "Psychology", depth: "degree",
  ours: { courses: 40, coursesBuilt: 1, units: { planned: 8, built: 1 }, topics: { planned: 40, built: 5, proved: 3 }, hours: { ...hours }, practice: { teachBacks: 40, quizQuestions: 200, practiceCases: 80, unitTestQuestions: 32, finalQuestions: 6 } },
  course: null,
  norms: [{ id: "n", label: "Courses in a BA", value: 40, unit: "courses", source: "University of Calgary", url: "https://example.org/x", retrievedOn: "2026-11-11", derived: "120 units / 3" }],
  notEquivalent: NOT_EQUIVALENT,
};

describe("Compare panel", () => {
  it("always shows the Not equivalent box, even before anything loads", () => {
    const html = renderToStaticMarkup(<ComparePanel programId="p1" />);
    expect(html).toContain("Not equivalent");
    for (const line of NOT_EQUIVALENT) expect(html.replace(/&#x27;/g, "'")).toContain(line);
  });

  it("shows our numbers beside sourced norms with links", () => {
    const html = renderToStaticMarkup(<ComparePanel programId="p1" initial={comparison} />);
    expect(html).toContain('href="https://example.org/x"');
    expect(html).toContain("read on 2026-11-11");
    expect(html).toContain("4.5 h planned");
    expect(html).toContain("Not equivalent");
    expect(renderToStaticMarkup(<ComparisonBody view={comparison} />)).toContain("120 units / 3");
  });
});

describe("SyllabusDocument", () => {
  const view: SyllabusView = {
    programId: "p1", programTitle: "Psychology", depth: "degree",
    course: { slug: "a", number: 1, title: "Intro", summary: "s", year: 1, term: 1, level: 100, requires: [], mapId: "m1" },
    status: "built",
    outcomes: [{ id: "o1", text: "Explain behaviour" }],
    units: [{ id: "u1", number: 1, title: "Survey", plannedTopics: 1, built: true, proved: 0, state: "open", test: "locked", outcomes: ["Explain behaviour"],
      topics: [{ id: "t1", title: "Memory", objectives: ["Define encoding"], keyTerms: ["encoding"], inScope: "stores", outOfScope: "brain", buildsOn: [], built: true, proved: false }] }],
    assessment: { unitTests: true, unitTestQuestions: 4, unitTestPassMark: 3, finalQuestions: 6, finalPassMark: 4, final: "locked" },
    hours: { ...hours },
    practice: comparison.ours.practice,
  };
  it("lists outcomes, topics with objectives and key terms, and assessment", () => {
    const html = renderToStaticMarkup(<SyllabusDocument view={view} />);
    for (const text of ["Explain behaviour", "Memory", "Define encoding", "encoding", "4 questions, pass mark 3", "6 questions, pass mark 4"]) expect(html).toContain(text);
  });
  it("shows the units so far while the syllabus is being written", () => {
    const planning: LiveSyllabusView = { ...view, planning: true, status: "draft" };
    const html = renderToStaticMarkup(<SyllabusDocument view={planning} />);
    expect(html).toContain("The syllabus is being written");
    expect(html).toContain("1 unit so far");
    expect(html).toContain("Memory");
    expect(syllabusIsPlanning(planning)).toBe(true);
    expect(syllabusIsPlanning(view)).toBe(false);
  });
  it("treats a started course with no syllabus yet as planning, and an unstarted one as none", () => {
    const empty: LiveSyllabusView = { ...view, status: "none", outcomes: [], units: [] };
    expect(syllabusIsPlanning(empty)).toBe(true);
    expect(renderToStaticMarkup(<SyllabusDocument view={empty} />)).toContain("The syllabus is being written");
    expect(syllabusIsPlanning({ ...empty, course: { ...empty.course, mapId: null } })).toBe(false);
  });
  it("says so when there is no syllabus yet", () => {
    expect(renderToStaticMarkup(<SyllabusDocument view={{ ...view, status: "none", outcomes: [], units: [], course: { ...view.course, mapId: null } }} />)).toContain("no syllabus yet");
  });
});
