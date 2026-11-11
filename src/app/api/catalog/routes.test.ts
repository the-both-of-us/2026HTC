/** The shared catalog routes on the in-memory store with no AI: the list is public-only and Start makes no model call. */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON, streamLines } from "@/features/ai";
import { catalogKeys, resetBrowseCacheForTests, type CatalogCourse, type CatalogProgram } from "@/features/catalog";
import { getSkillMap } from "@/features/skill-map";
import { getUserId } from "@/shared/identity";
import { putDoc } from "@/shared/store";
import { GET as listRoute } from "./route";
import { POST as startCourseRoute } from "./courses/[courseId]/start/route";
import { POST as startProgramRoute } from "./programs/[programId]/start/route";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn().mockRejectedValue(new Error("No AI in tests")),
  streamLines: vi.fn().mockRejectedValue(new Error("No AI in tests")),
}));
vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn() }));

const ME = randomUUID();
const OTHER = randomUUID();
const asUser = (id: string) => vi.mocked(getUserId).mockResolvedValue(id);
const startCourse = (courseId: string) =>
  startCourseRoute(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ courseId }) });
const startProgram = (programId: string) =>
  startProgramRoute(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ programId }) });

const topic = { id: "t1", title: "T", objectives: ["a", "b"], keyTerms: ["x", "y", "z"], inScope: "i", outOfScope: "o", buildsOn: [] };
const SYLLABUS = {
  version: 1,
  depth: "degree",
  courseSlug: "sd",
  outcomes: [],
  units: [{ id: "u1", title: "U", outcomeIds: [], built: false, topics: [topic, { ...topic, id: "t2" }] }],
  assessment: { unitTests: true, finalQuestions: 6 },
};

let courseId = "";
let programId = "";

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  resetBrowseCacheForTests();
  vi.mocked(chatJSON).mockClear();
  vi.mocked(streamLines).mockClear();
  asUser(ME);
  courseId = randomUUID();
  programId = randomUUID();
  const course: CatalogCourse = { id: courseId, title: "System design", summary: "Design scalable systems.", audience: "", createdAt: "2026-11-10T00:00:00Z" };
  await putDoc(catalogKeys.course(courseId), course);
  await putDoc(catalogKeys.syllabus(courseId), SYLLABUS);
  const program: CatalogProgram = {
    id: programId, title: "Backend", summary: "Servers.", audience: "", depth: "quick", status: "ready", createdAt: "2026-11-09T00:00:00Z",
    courses: [{ slug: "a", title: "A", summary: "s", requires: [], courseId }],
  };
  await putDoc(catalogKeys.program(programId), program);
  // An unfinished course must not be listed or startable.
  const draft = randomUUID();
  await putDoc(catalogKeys.course(draft), { ...course, id: draft, title: "System draft" });
});

describe("GET /api/catalog", () => {
  it("lists finished entries with public fields only, and filters by q", async () => {
    const body = await (await listRoute(new Request("http://localhost/api/catalog?q=SYSTEM"))).json();
    expect(body.courses).toEqual([
      { courseId, title: "System design", summary: "Design scalable systems.", audience: "", units: 1, topics: 2 },
    ]);
    expect(body.programs).toEqual([]);
    const all = await (await listRoute(new Request("http://localhost/api/catalog"))).json();
    expect(all.programs).toEqual([{ programId, title: "Backend", summary: "Servers.", audience: "", depth: "quick", courseCount: 1 }]);
    expect(JSON.stringify(all)).not.toMatch(/ownerId|authorId|sourceText|alias|hash|homeProgramId/);
  });
});

describe("Start", () => {
  it("starts the exact course with no model call and returns the same map the second time", async () => {
    const first = await startCourse(courseId);
    expect(first.status).toBe(201);
    const { id } = await first.json();
    expect((await getSkillMap(id))?.courseId).toBe(courseId);
    expect((await getSkillMap(id))?.ownerId).toBe(ME);
    const second = await startCourse(courseId);
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe(id);
    expect(chatJSON).not.toHaveBeenCalled();
    expect(streamLines).not.toHaveBeenCalled();
  });

  it("gives another viewer their own map", async () => {
    const mine = (await (await startCourse(courseId)).json()).id;
    asUser(OTHER);
    const theirs = (await (await startCourse(courseId)).json()).id;
    expect(theirs).not.toBe(mine);
    expect((await getSkillMap(theirs))?.ownerId).toBe(OTHER);
  });

  it("answers 404 for an unknown, malformed or unfinished course", async () => {
    expect((await startCourse(randomUUID())).status).toBe(404);
    expect((await startCourse("not-an-id")).status).toBe(404);
    const draft = randomUUID();
    await putDoc(catalogKeys.course(draft), { id: draft, title: "D", summary: "", audience: "", createdAt: "" });
    expect((await startCourse(draft)).status).toBe(404);
    expect(chatJSON).not.toHaveBeenCalled();
  });

  it("starts a program once per viewer and 404s an unknown one", async () => {
    const first = await startProgram(programId);
    expect(first.status).toBe(201);
    const { programId: mine } = await first.json();
    const second = await startProgram(programId);
    expect(second.status).toBe(200);
    expect((await second.json()).programId).toBe(mine);
    expect((await startProgram(randomUUID())).status).toBe(404);
    expect(chatJSON).not.toHaveBeenCalled();
    expect(streamLines).not.toHaveBeenCalled();
  });
});
