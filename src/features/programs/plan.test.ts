/**
 * The program frame as JSON Lines: per-line fixes and rejects, the degree repair for short terms,
 * and the short plan's minimum. The AI is a scripted fake.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamLines } from "@/features/ai";
import { HttpError } from "@/shared/http";
import { DEGREE_FRAME_SYSTEM, FrameBuilder, frameLine, isIntroductionTitle, SHORT_PLAN_SYSTEM, streamFrame } from "./plan";
import { degreeFrameLines, fakeStreamLines, psychologyPlanLines } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  streamLines: vi.fn(),
}));
const mockStream = vi.mocked(streamLines);

const course = (value: Record<string, unknown>) => frameLine.parse({ kind: "course", summary: "", requires: [], ...value }) as Extract<ReturnType<typeof frameLine.parse>, { kind: "course" }>;
const seed = (depth: "quick" | "degree") => ({ id: "p", title: "Psychology", summary: "", audience: "", depth, createdAt: "" });

beforeEach(() => {
  mockStream.mockReset();
});

describe("FrameBuilder", () => {
  it("suffixes a duplicate slug, rejects a near-duplicate title, and makes a quick course follow the one before", () => {
    const builder = new FrameBuilder("quick");
    expect(builder.takeCourse(course({ slug: "intro", title: "Introduction to psychology" }))).toMatchObject({ ok: true, course: { requires: [] } });
    expect(builder.takeCourse(course({ slug: "intro", title: "Research methods", requires: ["nope"] }))).toMatchObject({
      ok: true,
      course: { slug: "intro-2", requires: ["intro"] },
    });
    expect(builder.takeCourse(course({ slug: "x", title: "Psychology introduction" }))).toMatchObject({ ok: false });
    expect(builder.takeCourse(course({ slug: "y", title: "" }))).toMatchObject({ ok: false });
  });

  it("keeps degree requires to earlier terms, raises a falling level, and makes year 1 100-level", () => {
    const builder = new FrameBuilder("degree");
    builder.takeCourse(course({ slug: "a", title: "Alpha", year: 1, term: 1, level: 300 }));
    builder.takeCourse(course({ slug: "b", title: "Beta", year: 1, term: 2, level: 100, requires: ["a", "b"] }));
    builder.takeCourse(course({ slug: "c", title: "Gamma", year: 2, term: 1, level: 200, requires: ["b"] }));
    builder.takeCourse(course({ slug: "d", title: "Delta", year: 3, term: 1, level: 100, requires: ["c", "e"] }));
    const [a, b, c, d] = builder.courses;
    expect(a.level).toBe(100);
    expect(b.requires).toEqual(["a"]);
    expect(c.requires).toEqual(["b"]);
    expect(d).toMatchObject({ level: 200, requires: ["c"] });
  });

  it("stops at 6 courses in a term", () => {
    const builder = new FrameBuilder("degree");
    const words = ["amber", "birch", "cedar", "delta", "ember", "fjord", "grove"];
    const results = words.map((w) => builder.takeCourse(course({ slug: w, title: w, year: 1, term: 1, level: 100 })));
    expect(results.filter((r) => r.ok)).toHaveLength(6);
  });
});

describe("a field opens with its introduction course", () => {
  it("asks both the short plan and the degree frame for a plainly named introduction first, and keeps methods and statistics in year 1", () => {
    expect(SHORT_PLAN_SYSTEM).toContain('named "Introduction to" and the subject, such as "Introduction to psychology"');
    expect(DEGREE_FRAME_SYSTEM).toContain('named "Introduction to" and the field, such as "Introduction to psychology"');
    expect(DEGREE_FRAME_SYSTEM).toContain("The first course of year 1 term 1 is the plain survey of the whole field");
    expect(DEGREE_FRAME_SYSTEM).toContain("Year 1 must also include a research methods course and a statistics course");
  });

  it("knows an introduction title", () => {
    expect(isIntroductionTitle("Introduction to psychology")).toBe(true);
    expect(isIntroductionTitle("Intro to psychology")).toBe(true);
    expect(isIntroductionTitle("An introduction to economics")).toBe(true);
    expect(isIntroductionTitle("How psychologists study the mind")).toBe(false);
    expect(isIntroductionTitle("Introspection and consciousness")).toBe(false);
  });

  it("puts a degree's introduction first in year 1 term 1, moving it there from term 2", () => {
    const builder = new FrameBuilder("degree");
    builder.takeCourse(course({ slug: "methods", title: "Research methods", year: 1, term: 1 }));
    builder.takeCourse(course({ slug: "stats", title: "Statistics I", year: 1, term: 1 }));
    expect(builder.opensWithIntroduction()).toBe(false);
    expect(builder.takeCourse(course({ slug: "intro", title: "Introduction to psychology", year: 1, term: 2, requires: ["methods"] }))).toMatchObject({
      ok: true,
      course: { year: 1, term: 1, requires: [] },
    });
    expect(builder.ordered().map((c) => c.slug)).toEqual(["intro", "methods", "stats"]);
    expect(builder.opensWithIntroduction()).toBe(true);
  });

  it("warns, without failing, when a field's short plan does not open with an introduction", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStream.mockImplementation(
      fakeStreamLines(() => [
        { kind: "head", title: "Psychology", summary: "s", learnable: true },
        { kind: "course", slug: "a", title: "How psychologists study the mind", summary: "", requires: [] },
        { kind: "course", slug: "b", title: "Memory", summary: "", requires: [] },
        { kind: "course", slug: "c", title: "Social psychology", summary: "", requires: [] },
      ]),
    );
    const builder = await streamFrame(seed("quick"), { deadline: Date.now() + 100_000, onHead: async () => {}, onCourse: async () => {} });
    expect(builder.courses).toHaveLength(3);
    expect(warn.mock.calls.flat().join(" ")).toContain("not an introduction course");
    warn.mockRestore();
  });
});

describe("streamFrame", () => {
  const hooks = () => {
    const seen: string[] = [];
    return { seen, hooks: { deadline: Date.now() + 110_000, onHead: async () => void seen.push("head"), onCourse: async (c: { slug: string }) => void seen.push(c.slug) } };
  };

  it("commits a short plan line by line", async () => {
    mockStream.mockImplementation(fakeStreamLines((options) => (options.label === "short-plan" ? psychologyPlanLines() : null)));
    const { seen, hooks: h } = hooks();
    const builder = await streamFrame(seed("quick"), h);
    expect(seen[0]).toBe("head");
    expect(builder.ordered().map((c) => c.slug)).toEqual(seen.slice(1));
    expect(mockStream.mock.calls[0][0]).toMatchObject({ profile: "plan", label: "short-plan" });
  });

  it("refuses a short plan of fewer than 3 courses, and a subject that is not learnable", async () => {
    mockStream.mockImplementation(fakeStreamLines(() => psychologyPlanLines().slice(0, 3)));
    await expect(streamFrame(seed("quick"), hooks().hooks)).rejects.toBeInstanceOf(HttpError);
    mockStream.mockImplementation(fakeStreamLines(() => [{ kind: "head", title: "", summary: "", learnable: false }]));
    await expect(streamFrame(seed("quick"), hooks().hooks)).rejects.toMatchObject({ status: 422 });
  });

  it("repairs a degree's short terms with one call that lists the committed courses", async () => {
    const full = degreeFrameLines();
    // The first reply stops after year 3 term 2: year 4 is missing.
    const firstReply = full.filter((line) => line.kind === "head" || (line.year as number) < 4);
    let repairPrompt = "";
    mockStream.mockImplementation(
      fakeStreamLines((options) => {
        if (options.label === "degree-frame") return firstReply;
        repairPrompt = options.prompt;
        return full.filter((line) => line.year === 4);
      }),
    );
    const builder = await streamFrame(seed("degree"), hooks().hooks);
    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(repairPrompt).toContain("year 4 term 1: 5 more courses");
    expect(repairPrompt).toContain("course-1 (year 1, term 1, 100)");
    expect(builder.courses).toHaveLength(40);
    expect(builder.shortTerms()).toEqual([]);
  });
});
