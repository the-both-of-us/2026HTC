/**
 * ensureCourseBuilt on its own: unit 1's nodes start the moment unit 1 commits (pipelined with the
 * rest of the syllabus), viewers see committed units while the syllabus streams, and a second
 * build of the same course while the first runs is a no-op.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamLines, type StreamLinesOptions, type StreamLinesResult } from "@/features/ai";
import { claimCourse, readCatalogSyllabus } from "@/features/catalog";
import { ensureUnitNodes } from "@/features/skill-map";
import { setOnceTimingForTests } from "@/shared/store/once";
import { deadlineFrom } from "./pregen";
import { ensureCourseBuilt } from "./build";
import { syllabusLines, unitNodes } from "./test-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  streamLines: vi.fn(),
  chatJSON: vi.fn(),
}));
vi.mock("@/features/skill-map", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/skill-map")>()),
  ensureUnitNodes: vi.fn(),
}));

const mockStream = vi.mocked(streamLines);
const mockUnits = vi.mocked(ensureUnitNodes);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  setOnceTimingForTests({ writeEveryMs: 1 });
  mockStream.mockReset();
  mockUnits.mockReset();
});

async function newCourse() {
  const { id } = await claimCourse({ text: "Introduction to psychology", audience: "", title: "Introduction to psychology", summary: "Know the field." });
  return id;
}

describe("ensureCourseBuilt", () => {
  it("starts unit 1 while the rest of the syllabus streams, and viewers see each committed unit", async () => {
    const courseId = await newCourse();
    const seen: { line: number; unit1Started: boolean; unitsVisible: number }[] = [];
    mockUnits.mockImplementation(async (input) => ({ status: "ready", nodes: unitNodes(input.syllabus.units[0].topics.map((t) => t.id)) }));
    mockStream.mockImplementation((async <L>(options: StreamLinesOptions<L>): Promise<StreamLinesResult<L>> => {
      const lines: L[] = [];
      for (const [index, raw] of syllabusLines("psych").entries()) {
        const parsed = options.line.parse(raw);
        lines.push(parsed);
        await options.onLine(parsed, index);
        await tick();
        const read = await readCatalogSyllabus(courseId);
        seen.push({ line: index, unit1Started: mockUnits.mock.calls.length > 0, unitsVisible: read.state === "planning" ? read.syllabus.units.length : -1 });
      }
      return { lines, rejected: [], truncated: false };
    }) as typeof streamLines);

    const result = await ensureCourseBuilt(courseId, { deadline: deadlineFrom() });

    expect(result.syllabus).toBe("built");
    expect(result.unit1).toMatchObject({ status: "ready" });
    // Line 1 is unit 1: its build started right then, long before the last unit arrived.
    expect(seen[1]).toMatchObject({ unit1Started: true, unitsVisible: 1 });
    expect(seen[0].unit1Started).toBe(false);
    expect(seen.at(-1)!.unitsVisible).toBe(8);
    expect(mockUnits).toHaveBeenCalledTimes(1);
    // Unit 1 was built from the units committed so far, keyed by the catalog course.
    expect(mockUnits.mock.calls[0][0]).toMatchObject({ contentId: courseId, unitId: "u1" });
    const final = await readCatalogSyllabus(courseId);
    expect(final.state).toBe("ready");
    expect(final.state === "ready" && final.syllabus).toMatchObject({ rootMapId: courseId });
    expect(final.state === "ready" && final.syllabus.planning).toBeFalsy();
  });

  it("generates once when two builds of one course overlap", async () => {
    const courseId = await newCourse();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockUnits.mockResolvedValue({ status: "ready", nodes: [] });
    mockStream.mockImplementation((async <L>(options: StreamLinesOptions<L>): Promise<StreamLinesResult<L>> => {
      await gate;
      const lines = syllabusLines("psych").map((raw) => options.line.parse(raw));
      for (const [index, line] of lines.entries()) await options.onLine(line, index);
      return { lines, rejected: [], truncated: false };
    }) as typeof streamLines);

    const first = ensureCourseBuilt(courseId, { deadline: deadlineFrom() });
    await tick();
    expect(await ensureCourseBuilt(courseId, { deadline: deadlineFrom() })).toEqual({ syllabus: "running", unit1: null });
    release();
    expect((await first).syllabus).toBe("built");
    // Built now: a third call only ensures unit 1 (from the cache), with no new syllabus call.
    expect((await ensureCourseBuilt(courseId, { deadline: deadlineFrom() })).syllabus).toBe("ready");
    expect(mockStream).toHaveBeenCalledTimes(1);
  });
});
