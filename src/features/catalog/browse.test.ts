import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDoc, putDoc } from "@/shared/store";
import type { CourseSyllabus } from "@/shared/types";
import {
  BROWSE_CACHE_MS,
  catalogKeys,
  listSharedCourses,
  listSharedPrograms,
  MAX_BROWSE_RESULTS,
  resetBrowseCacheForTests,
  type CatalogCourse,
  type CatalogProgram,
} from "./index";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  resetBrowseCacheForTests();
});

const topic = (id: string) => ({ id, title: id, objectives: ["a", "b"], keyTerms: ["x", "y", "z"], inScope: "in", outOfScope: "out", buildsOn: [] });
const syllabus = (units: number, topicsPerUnit: number, extra: Partial<CourseSyllabus> = {}): CourseSyllabus => ({
  version: 1,
  depth: "degree",
  courseSlug: "c",
  outcomes: [],
  units: Array.from({ length: units }, (_, u) => ({
    id: `u${u + 1}`,
    title: `Unit ${u + 1}`,
    outcomeIds: [],
    built: false,
    topics: Array.from({ length: topicsPerUnit }, (_, t) => topic(`u${u}-t${t}`)),
  })),
  assessment: { unitTests: true, finalQuestions: 6 },
  ...extra,
});

async function addCourse(title: string, createdAt: string, syl: CourseSyllabus | null, summary = `Learn ${title}.`) {
  const id = randomUUID();
  const course: CatalogCourse = { id, title, summary, audience: "", createdAt, homeProgramId: randomUUID(), homeSlug: "secret-slug" };
  await putDoc(catalogKeys.course(id), course);
  if (syl) await putDoc(catalogKeys.syllabus(id), syl);
  return id;
}

async function addProgram(title: string, createdAt: string, courses: number, depth: "quick" | "degree" = "quick") {
  const id = randomUUID();
  const program: CatalogProgram = {
    id,
    title,
    summary: `Path through ${title}.`,
    audience: "",
    depth,
    status: "ready",
    createdAt,
    courses: Array.from({ length: courses }, (_, i) => ({ slug: `c${i}`, title: `C${i}`, summary: "s", requires: [], courseId: randomUUID() })),
  };
  await putDoc(catalogKeys.program(id), program);
  return id;
}

describe("listSharedCourses", () => {
  it("lists only courses with a final syllabus, newest first, with counted units and topics", async () => {
    const old = await addCourse("System design", "2026-11-01T00:00:00Z", syllabus(8, 5));
    const fresh = await addCourse("SQL", "2026-11-09T00:00:00Z", syllabus(1, 7));
    await addCourse("Never built", "2026-11-10T00:00:00Z", null);
    await addCourse("Still planning", "2026-11-10T00:00:00Z", syllabus(2, 5, { planning: true }));
    const list = await listSharedCourses();
    expect(list.map((c) => c.courseId)).toEqual([fresh, old]);
    expect(list[1]).toMatchObject({ units: 8, topics: 40 });
    expect(list[0]).toMatchObject({ units: 1, topics: 7 });
  });

  it("returns only the public fields", async () => {
    await addCourse("SQL", "2026-11-09T00:00:00Z", syllabus(1, 7));
    const [course] = await listSharedCourses();
    expect(Object.keys(course).sort()).toEqual(["audience", "courseId", "summary", "title", "topics", "units"]);
  });

  it("filters by title or summary, ignoring case", async () => {
    await addCourse("System design", "2026-11-01T00:00:00Z", syllabus(2, 5), "Scale a service.");
    await addCourse("SQL", "2026-11-02T00:00:00Z", syllabus(2, 5), "Query a SYSTEM of tables.");
    await addCourse("Poetry", "2026-11-03T00:00:00Z", syllabus(2, 5), "Verse.");
    expect((await listSharedCourses({ q: "  SyStEm " })).map((c) => c.title)).toEqual(["SQL", "System design"]);
    expect(await listSharedCourses({ q: "nothing like this" })).toEqual([]);
  });

  it("returns at most 60", async () => {
    for (let i = 0; i < MAX_BROWSE_RESULTS + 5; i++) await addCourse(`Course ${i}`, `2026-11-01T00:${String(i).padStart(2, "0")}:00Z`, syllabus(1, 5));
    expect(await listSharedCourses()).toHaveLength(MAX_BROWSE_RESULTS);
  });

  it("reuses one snapshot for a short time, so a keystroke costs no store reads", async () => {
    await addCourse("First", "2026-11-01T00:00:00Z", syllabus(1, 5));
    expect(await listSharedCourses()).toHaveLength(1);
    await addCourse("Second", "2026-11-02T00:00:00Z", syllabus(1, 5));
    expect(await listSharedCourses({ q: "s" })).toHaveLength(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + BROWSE_CACHE_MS + 1);
    try {
      expect(await listSharedCourses()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("listSharedPrograms", () => {
  it("lists final programs newest first with a counted course count, depth and public fields", async () => {
    const a = await addProgram("Backend", "2026-11-01T00:00:00Z", 5);
    const b = await addProgram("Psychology", "2026-11-05T00:00:00Z", 40, "degree");
    await putDoc(catalogKeys.program(randomUUID()), { ...(await getDoc<CatalogProgram>(catalogKeys.program(a)))!, courses: [] });
    const list = await listSharedPrograms();
    expect(list.map((p) => p.programId)).toEqual([b, a]);
    expect(list[0]).toMatchObject({ depth: "degree", courseCount: 40 });
    expect(Object.keys(list[0]).sort()).toEqual(["audience", "courseCount", "depth", "programId", "summary", "title"]);
    expect((await listSharedPrograms({ q: "BACK" })).map((p) => p.title)).toEqual(["Backend"]);
  });
});
