import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { deleteSkillMap, generateSkillMap, getSkillMap } from "@/features/skill-map";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { getDoc, listDocs, putDoc } from "@/shared/store";
import { listCourses } from "./courses";
import { ensureSampleCourses, RECHECK_AFTER_MS, resetSeedStateForTests, SEED_OWNER_ID } from "./seed";
import { resetStore } from "./testing";
import type { CourseListing } from "./types";

// The real store, with a switch to make reads of one key fail, like a Blob 503.
const failReads = { key: "", times: 0 };
vi.mock("@/shared/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/store")>();
  return {
    ...actual,
    getDoc: async <T,>(key: string): Promise<T | null> => {
      if (key === failReads.key && failReads.times > 0) {
        failReads.times -= 1;
        throw new Error("blob 503");
      }
      return actual.getDoc<T>(key);
    },
  };
});

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

// The real generateSkillMap runs (it uses saved output for the samples), wrapped so tests can count or break it.
vi.mock("@/features/skill-map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/skill-map")>();
  return { ...actual, generateSkillMap: vi.fn(actual.generateSkillMap) };
});

const mockChatJSON = vi.mocked(chatJSON);
const mockGenerate = vi.mocked(generateSkillMap);
let realGenerate: typeof generateSkillMap;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  resetStore();
  Object.assign(failReads, { key: "", times: 0 });
  vi.restoreAllMocks();
  mockChatJSON.mockReset();
  realGenerate ??= (await vi.importActual<typeof import("@/features/skill-map")>("@/features/skill-map"))
    .generateSkillMap;
  mockGenerate.mockReset();
  mockGenerate.mockImplementation(realGenerate);
});

async function sampleListings(): Promise<CourseListing[]> {
  return (await listDocs<CourseListing>("courses/")).filter((listing) => listing.isSample);
}

/** Saves a second seeded listing for a sample, as two servers seeding at once would. Returns its map id. */
async function saveDuplicateListing(text: string): Promise<string> {
  const duplicate = await realGenerate({ text, kind: "posting", ownerId: SEED_OWNER_ID });
  const now = new Date().toISOString();
  await putDoc(`courses/${duplicate.id}`, {
    mapId: duplicate.id,
    title: duplicate.title,
    subtitle: duplicate.subtitle,
    authorId: SEED_OWNER_ID,
    authorName: "OryxLearn team",
    skillCount: duplicate.nodes.length,
    likeCount: 0,
    isSample: true,
    publishedAt: now,
    updatedAt: now,
  } satisfies CourseListing);
  return duplicate.id;
}

describe("ensureSampleCourses", () => {
  it("publishes every sample posting as a labelled course, with no AI call", async () => {
    const mapIds = await ensureSampleCourses();

    expect(mapIds).toHaveLength(SAMPLE_POSTINGS.length);
    expect(mockChatJSON).not.toHaveBeenCalled();
    const listings = await sampleListings();
    expect(listings).toHaveLength(SAMPLE_POSTINGS.length);
    for (const listing of listings) {
      expect(listing).toMatchObject({ authorName: "OryxLearn team", isSample: true, likeCount: 0 });
      expect(listing.title).not.toMatch(/test/i);
      expect(listing.skillCount).toBeGreaterThan(0);
      expect((await getSkillMap(listing.mapId))?.ownerId).toBe(SEED_OWNER_ID);
    }
    for (const sample of SAMPLE_POSTINGS) {
      expect(await getDoc(`course-seeds/${sample.id}`)).toMatchObject({ mapId: expect.any(String) });
    }
  });

  it("is idempotent: a second run makes no new maps", async () => {
    const first = await ensureSampleCourses();
    resetSeedStateForTests(); // skip the in-memory shortcut, so the store is really checked
    const second = await ensureSampleCourses();

    expect(second).toEqual(first);
    expect(mockGenerate).toHaveBeenCalledTimes(SAMPLE_POSTINGS.length);
    expect(await sampleListings()).toHaveLength(SAMPLE_POSTINGS.length);
  });

  it("shares one run between concurrent callers", async () => {
    const results = await Promise.all([ensureSampleCourses(), ensureSampleCourses(), listCourses({ sort: "new" })]);

    expect(results[0]).toEqual(results[1]);
    expect(mockGenerate).toHaveBeenCalledTimes(SAMPLE_POSTINGS.length);
    expect(await sampleListings()).toHaveLength(SAMPLE_POSTINGS.length);
  });

  it("rebuilds a sample whose map was deleted", async () => {
    const [firstId] = await ensureSampleCourses();
    await deleteSkillMap(firstId);
    resetSeedStateForTests();

    const again = await ensureSampleCourses();
    expect(again[0]).not.toBe(firstId);
    expect(mockGenerate).toHaveBeenCalledTimes(SAMPLE_POSTINGS.length + 1);
  });

  it("still lists the other samples when one fails, logs it, and waits before retrying", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = SAMPLE_POSTINGS[1];
    mockGenerate.mockImplementation(async (input) => {
      if (input.text === broken.text) throw new Error("store down");
      return realGenerate(input);
    });

    const courses = await listCourses({ sort: "new" });
    expect(courses.filter((course) => course.isSample)).toHaveLength(SAMPLE_POSTINGS.length - 1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^\[courses\]/);
    expect(await getDoc(`course-seeds/${broken.id}`)).toBeNull();

    // Within the wait, the broken sample is not tried again.
    const callsBefore = mockGenerate.mock.calls.length;
    await listCourses({ sort: "new" });
    expect(mockGenerate.mock.calls.length).toBe(callsBefore);
    log.mockRestore();
  });

  it("hides a duplicate sample listing left by two servers seeding at once", async () => {
    await ensureSampleCourses();
    const duplicate = await saveDuplicateListing(SAMPLE_POSTINGS[0].text);

    const courses = await listCourses({ sort: "new" });
    expect(courses.filter((course) => course.isSample)).toHaveLength(SAMPLE_POSTINGS.length);
    expect(courses.some((course) => course.mapId === duplicate)).toBe(false);
  });

  it("keeps listing an intact sample after one failed read, during and after the retry wait", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await listCourses({ sort: "new" })).toHaveLength(SAMPLE_POSTINGS.length);
    // A leftover duplicate from two servers seeding at once, which must stay hidden throughout.
    const duplicate = await saveDuplicateListing(SAMPLE_POSTINGS[0].text);

    // Past the recheck, one read of the first sample's seed document fails.
    now.mockReturnValue(start + RECHECK_AFTER_MS + 1_000);
    Object.assign(failReads, { key: `course-seeds/${SAMPLE_POSTINGS[0].id}`, times: 1 });
    expect(await listCourses({ sort: "new" })).toHaveLength(SAMPLE_POSTINGS.length);

    // Four minutes later the sample is still waiting to retry, and the store is healthy.
    now.mockReturnValue(start + RECHECK_AFTER_MS + 1_000 + 4 * 60_000);
    const later = await listCourses({ sort: "new" });
    expect(later).toHaveLength(SAMPLE_POSTINGS.length);
    expect(later.some((course) => course.mapId === duplicate)).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(SAMPLE_POSTINGS.length);
  });

  it("does not hide seeded listings when a sample's current map is unknown", async () => {
    await ensureSampleCourses();
    resetSeedStateForTests(); // a fresh server, which has never seen the samples
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(failReads, { key: `course-seeds/${SAMPLE_POSTINGS[0].id}`, times: 1 });

    const courses = await listCourses({ sort: "new" });
    expect(courses.filter((course) => course.isSample)).toHaveLength(SAMPLE_POSTINGS.length);
  });
});
