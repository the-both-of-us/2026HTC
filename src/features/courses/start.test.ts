import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { copySkillMap, deleteSkillMap, getSkillMap } from "@/features/skill-map";
import { getProgress } from "@/features/teachback";
import { getDoc } from "@/shared/store";
import { getCourse, publishCourse, unpublishCourse } from "./courses";
import { COURSE_NOT_FOUND, CoursesError } from "./errors";
import { ensureSampleCourses } from "./seed";
import { startCourse, startKey } from "./start";
import { resetStore, saveMap } from "./testing";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

// The real copySkillMap, wrapped so tests can count calls.
vi.mock("@/features/skill-map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/skill-map")>();
  return { ...actual, copySkillMap: vi.fn(actual.copySkillMap) };
});

// The real getProgress, wrapped so tests can see which map's progress the course page reads.
vi.mock("@/features/teachback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/teachback")>();
  return { ...actual, getProgress: vi.fn(actual.getProgress) };
});

const OWNER = randomUUID();
const LEARNER = randomUUID();
const mockCopy = vi.mocked(copySkillMap);

async function caught(promise: Promise<unknown>): Promise<CoursesError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(CoursesError);
  return error as CoursesError;
}

/** A published course owned by OWNER. */
async function publishedCourse() {
  const map = await saveMap(OWNER);
  await publishCourse(map.id, OWNER, "Ana");
  return map;
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  resetStore();
  vi.mocked(chatJSON).mockReset();
  mockCopy.mockClear();
  vi.mocked(getProgress).mockClear();
});

describe("startCourse", () => {
  it("gives the owner their own map back and makes no copy", async () => {
    const map = await saveMap(OWNER);
    expect(await startCourse(map.id, OWNER)).toEqual({ mapId: map.id, created: false });
    expect(mockCopy).not.toHaveBeenCalled();
    expect(await getDoc(startKey(map.id, OWNER))).toBeNull();
  });

  it("answers a private course with the same 404 as a missing one", async () => {
    const map = await saveMap(OWNER);
    const hidden = await caught(startCourse(map.id, LEARNER));
    const missing = await caught(startCourse(randomUUID(), LEARNER));
    const malformed = await caught(startCourse("not-a-map", LEARNER));
    for (const error of [hidden, missing, malformed]) {
      expect(error.status).toBe(404);
      expect(error.message).toBe(COURSE_NOT_FOUND);
    }
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it("stops working once the course is made private again", async () => {
    const map = await publishedCourse();
    await unpublishCourse(map.id, OWNER);
    expect((await caught(startCourse(map.id, LEARNER))).status).toBe(404);
  });

  it("copies a published course into a private map the learner owns", async () => {
    const map = await publishedCourse();
    const result = await startCourse(map.id, LEARNER);

    expect(result.created).toBe(true);
    expect(result.mapId).not.toBe(map.id);
    const copy = await getSkillMap(result.mapId);
    expect(copy).toMatchObject({ ownerId: LEARNER, forkedFrom: map.id, title: map.title, nodes: map.nodes });
    expect(await getDoc(startKey(map.id, LEARNER))).toEqual({ copyId: result.mapId, startedAt: expect.any(String) });

    // The copy is private: it is not in the directory, and only the learner can see its course page.
    expect((await getCourse(result.mapId, LEARNER)).published).toBe(false);
    expect((await caught(getCourse(result.mapId, OWNER))).status).toBe(404);
  });

  it("returns the same copy the second time, and copies once", async () => {
    const map = await publishedCourse();
    const first = await startCourse(map.id, LEARNER);
    const second = await startCourse(map.id, LEARNER);
    expect(second).toEqual({ mapId: first.mapId, created: false });
    expect(mockCopy).toHaveBeenCalledTimes(1);
  });

  it("makes one copy when the learner double clicks", async () => {
    const map = await publishedCourse();
    const results = await Promise.all([1, 2, 3].map(() => startCourse(map.id, LEARNER)));
    expect(new Set(results.map((result) => result.mapId)).size).toBe(1);
    expect(mockCopy).toHaveBeenCalledTimes(1);
    // The run is forgotten once it settles, and the next call finds the saved copy.
    expect(await startCourse(map.id, LEARNER)).toEqual({ mapId: results[0].mapId, created: false });
  });

  it("gives each learner their own copy", async () => {
    const map = await publishedCourse();
    const other = randomUUID();
    const [mine, theirs] = await Promise.all([startCourse(map.id, LEARNER), startCourse(map.id, other)]);
    expect(mine.mapId).not.toBe(theirs.mapId);
    expect(mockCopy).toHaveBeenCalledTimes(2);
  });

  it("makes a new copy when the old one was deleted", async () => {
    const map = await publishedCourse();
    const first = await startCourse(map.id, LEARNER);
    await deleteSkillMap(first.mapId);

    const second = await startCourse(map.id, LEARNER);
    expect(second.created).toBe(true);
    expect(second.mapId).not.toBe(first.mapId);
    expect(await getDoc(startKey(map.id, LEARNER))).toMatchObject({ copyId: second.mapId });
  });

  it("refuses a user id that is not one of ours", async () => {
    const map = await publishedCourse();
    expect((await caught(startCourse(map.id, "../../maps"))).status).toBe(400);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it("lets the run fail without leaving it stuck", async () => {
    const map = await publishedCourse();
    mockCopy.mockRejectedValueOnce(new Error("store down"));
    await expect(startCourse(map.id, LEARNER)).rejects.toThrow("store down");
    expect((await startCourse(map.id, LEARNER)).created).toBe(true);
  });
});

describe("getCourse myCopyId", () => {
  it("is null before the learner starts, then their copy", async () => {
    const map = await publishedCourse();
    expect((await getCourse(map.id, LEARNER)).myCopyId).toBeNull();
    const { mapId } = await startCourse(map.id, LEARNER);
    expect((await getCourse(map.id, LEARNER)).myCopyId).toBe(mapId);
    // Someone else's copy is never shown.
    expect((await getCourse(map.id, randomUUID())).myCopyId).toBeNull();
  });

  it("is always null for the owner", async () => {
    const map = await publishedCourse();
    await startCourse(map.id, OWNER);
    expect((await getCourse(map.id, OWNER)).myCopyId).toBeNull();
  });

  it("is null once the copy is deleted", async () => {
    const map = await publishedCourse();
    const { mapId } = await startCourse(map.id, LEARNER);
    await deleteSkillMap(mapId);
    expect((await getCourse(map.id, LEARNER)).myCopyId).toBeNull();
  });

  it("is null when the start document points at a map the learner does not own", async () => {
    const map = await publishedCourse();
    const { mapId } = await startCourse(map.id, LEARNER);
    // As if the copy had been replaced by someone else's map under the same id.
    await saveMap(OWNER, { id: mapId });
    expect((await getCourse(map.id, LEARNER)).myCopyId).toBeNull();
    expect((await startCourse(map.id, LEARNER)).created).toBe(true);
  });
});

describe("a copy of a sample course", () => {
  it("is labelled a sample when the learner publishes it", async () => {
    const [sampleId] = await ensureSampleCourses();
    expect(sampleId).toBeDefined();
    const { mapId } = await startCourse(sampleId, LEARNER);

    expect((await getCourse(mapId, LEARNER)).isSample).toBe(true);
    const course = await publishCourse(mapId, LEARNER, "Lee");
    expect(course).toMatchObject({ mapId, isSample: true, authorName: "Lee" });
    expect(chatJSON).not.toHaveBeenCalled();
  });
});

describe("getCourse skill states", () => {
  it("are null for a viewer who has not started the course", async () => {
    const map = await publishedCourse();
    expect((await getCourse(map.id, LEARNER)).skillStates).toBeNull();
    expect(getProgress).not.toHaveBeenCalled();
  });

  it("come from the owner's own map for the owner", async () => {
    const map = await publishedCourse();
    const detail = await getCourse(map.id, OWNER);
    expect(getProgress).toHaveBeenCalledWith(map.id, OWNER);
    expect(Object.keys(detail.skillStates ?? {}).sort()).toEqual(map.nodes.map((node) => node.id).sort());
    // Nothing is proved yet, so a skill with no prerequisites is ready and none is proven.
    expect(Object.values(detail.skillStates ?? {})).not.toContain("proven");
    expect(Object.values(detail.skillStates ?? {})).toContain("available");
  });

  it("come from the learner's copy once they started, keyed by the course's skill ids", async () => {
    const map = await publishedCourse();
    const { mapId: copyId } = await startCourse(map.id, LEARNER);
    const detail = await getCourse(map.id, LEARNER);
    expect(detail.myCopyId).toBe(copyId);
    expect(getProgress).toHaveBeenCalledWith(copyId, LEARNER);
    expect(Object.keys(detail.skillStates ?? {}).sort()).toEqual(map.nodes.map((node) => node.id).sort());
  });

  it("are null, and the page still loads, when progress can't be read", async () => {
    const map = await publishedCourse();
    vi.mocked(getProgress).mockRejectedValueOnce(new Error("store down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const detail = await getCourse(map.id, OWNER);
    quiet.mockRestore();
    expect(detail.skillStates).toBeNull();
    expect(detail.title).toBe(map.title);
  });
});
