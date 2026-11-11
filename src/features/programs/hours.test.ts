/**
 * Computed hours and the unlock rule: pure functions, no store and no AI.
 */
import { describe, expect, it } from "vitest";
import { measuredHours, plannedHours, practiceCounts, writtenHours, type CourseFacts } from "./hours";
import { courseFacts } from "./programs";
import { courseStates } from "./unlock";

describe("unlock rules", () => {
  it("opens a catalog (full) course at a quarter of the required course's planned topics; old quick programs keep half", () => {
    const courses = [{ slug: "a", title: "A", requires: [] }, { slug: "b", title: "B", requires: ["a"] }];
    expect(courseStates(courses, {}, "degree").b).toEqual({ state: "locked", blockers: [{ title: "A", needed: null }] });
    expect(courseStates(courses, { a: { proven: 7, total: 32 } }, "degree").b.blockers).toEqual([{ title: "A", needed: 1 }]);
    expect(courseStates(courses, { a: { proven: 8, total: 32 } }, "degree").b.state).toBe("open");
    expect(courseStates(courses, { a: { proven: 8, total: 32 } }).b.blockers).toEqual([{ title: "A", needed: 8 }]);
    // A course already started is never locked again.
    expect(courseStates(courses, { b: { proven: 0, total: 4 } }, "degree").b.state).toBe("open");
    // A full course is done only when complete says so.
    expect(courseStates(courses, { a: { proven: 32, total: 32, complete: false } }, "degree").a.state).toBe("open");
  });
});

describe("hours", () => {
  const facts = (over: Partial<CourseFacts> = {}): CourseFacts => ({
    depth: "degree",
    lessonWords: { min: 1000, max: 1400 },
    practiceCasesPerTopic: 2,
    plan: { topics: 32, units: 8, unitTests: true, finalQuestions: 6 },
    writtenWords: [],
    activity: [],
    ...over,
  });

  it("plans from topics and lesson length, at 200 words a minute", () => {
    // 32 topics x 1,000 to 1,400 words / 200 wpm = 160 to 224 minutes.
    expect(plannedHours([facts()])).toMatchObject({ hours: 2.7, hoursMax: 3.7, label: "planned" });
    // A course not planned yet: 8 units of 4 to 6 topics.
    expect(plannedHours([facts({ plan: null })])).toMatchObject({ hours: 2.7, hoursMax: 5.6 });
  });

  it("counts written reading from the real lesson word counts", () => {
    expect(writtenHours([facts()]).hours).toBeNull();
    expect(writtenHours([facts({ writtenWords: [1200, 1200, 1200] })])).toMatchObject({ hours: 0.3, label: "written" });
  });

  it("measures only gaps under 10 minutes between the learner's own actions", () => {
    const at = (minutes: number) => new Date(Date.parse("2026-11-07T10:00:00Z") + minutes * 60_000).toISOString();
    expect(measuredHours([facts({ activity: [at(0), at(5), at(10), at(60), at(62)] })])).toMatchObject({ hours: 0.2 });
    expect(measuredHours([facts()]).hours).toBeNull();
  });

  it("counts practice as items, never minutes", () => {
    expect(practiceCounts([facts(), facts({ plan: null })], 5)).toEqual({
      teachBacks: 32,
      quizQuestions: 160,
      practiceCases: 64,
      unitTestQuestions: 32,
      finalQuestions: 6,
    });
  });

  it("writes every catalog course to full-course length, pitched at its audience", () => {
    const program = { id: "p", ownerId: "o", title: "Grade 1 math", summary: "", sourceKind: "topic" as const, sourceText: "grade 1 math", courses: [], createdAt: "", catalogId: "c" };
    const loaded = { course: { slug: "a", title: "A", summary: "", requires: [] }, index: 0, map: null, syllabus: null, progress: null, built: null, rail: null, units: null, final: null };
    expect(courseFacts({ ...program, audience: "Grade 1 students (about 6 years old)" }, loaded).lessonWords.max).toBeLessThan(1000);
    expect(courseFacts({ ...program, title: "Psychology", sourceText: "psychology", audience: "" }, loaded)).toMatchObject({
      depth: "degree",
      lessonWords: { min: 1000, max: 1400 },
      practiceCasesPerTopic: 2,
      plan: null,
    });
  });
});
