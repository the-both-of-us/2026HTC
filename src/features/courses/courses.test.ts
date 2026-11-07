import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { generateSkillMap } from "@/features/skill-map";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { getDoc, putDoc } from "@/shared/store";
import { getCourse, isPublished, listCourses, publishCourse, unpublishCourse } from "./courses";
import { CoursesError } from "./errors";
import { likeCourse } from "./likes";
import { makeNode, resetStore, saveMap } from "./testing";
import { toPublicCourse, type CourseListing } from "./types";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

const OWNER = randomUUID();
const OTHER = randomUUID();

async function expectCoursesError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CoursesError);
  expect((error as CoursesError).status).toBe(status);
  expect((error as CoursesError).message).toMatch(/\.$/);
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  resetStore();
  vi.mocked(chatJSON).mockReset();
});

describe("toPublicCourse", () => {
  it("never includes authorId or ownerId, even if a listing carries extra fields", () => {
    const listing = {
      mapId: "m",
      title: "T",
      subtitle: "S",
      authorId: OWNER,
      ownerId: OWNER,
      authorName: "Ana",
      skillCount: 2,
      likeCount: 1,
      isSample: false,
      publishedAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    } as CourseListing;
    const course = toPublicCourse(listing);
    const text = JSON.stringify(course);
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain("authorId");
    expect(text).not.toContain("ownerId");
    expect(course).toEqual({
      mapId: "m",
      title: "T",
      subtitle: "S",
      authorName: "Ana",
      skillCount: 2,
      likeCount: 1,
      isSample: false,
      publishedAt: "2026-11-07T00:00:00.000Z",
      updatedAt: "2026-11-07T00:00:00.000Z",
    });
  });
});

describe("publishCourse", () => {
  it("lists the owner's map with its title, subtitle and skill count", async () => {
    const map = await saveMap(OWNER, { nodes: [makeNode("a"), makeNode("b"), makeNode("c")] });
    const course = await publishCourse(map.id, OWNER, "  Ana   Lopez ");

    expect(course).toMatchObject({
      mapId: map.id,
      title: "Data analyst",
      subtitle: "Calgary",
      authorName: "Ana Lopez",
      skillCount: 3,
      likeCount: 0,
      isSample: false,
    });
    expect(JSON.stringify(course)).not.toContain(OWNER);
    const saved = await getDoc<CourseListing>(`courses/${map.id}`);
    expect(saved?.authorId).toBe(OWNER);
    expect(await isPublished(map.id)).toBe(true);
  });

  it("shows Anonymous learner when no name is given", async () => {
    const map = await saveMap(OWNER);
    expect((await publishCourse(map.id, OWNER)).authorName).toBe("Anonymous learner");
    expect((await publishCourse(map.id, OWNER, "   ")).authorName).toBe("Anonymous learner");
  });

  it("refuses anyone but the owner with a 403, and a missing or malformed map with a 404", async () => {
    const map = await saveMap(OWNER);
    await expectCoursesError(publishCourse(map.id, OTHER), 403);
    await expectCoursesError(publishCourse(randomUUID(), OWNER), 404);
    await expectCoursesError(publishCourse("../../etc/passwd", OWNER), 404);
    expect(await isPublished(map.id)).toBe(false);
  });

  it("refuses a name over 40 characters, and saves nothing", async () => {
    const map = await saveMap(OWNER);
    await expectCoursesError(publishCourse(map.id, OWNER, "x".repeat(41)), 400);
    expect(await isPublished(map.id)).toBe(false);
  });

  it("refuses the sample courses' name in any spelling, and saves nothing", async () => {
    const map = await saveMap(OWNER);
    for (const name of ["OryxLearn team", "oryxlearn TEAM", "  Oryx Learn-Team ", "ORYXLEARN\u200bteam"]) {
      await expectCoursesError(publishCourse(map.id, OWNER, name), 400);
    }
    expect(await isPublished(map.id)).toBe(false);
    // A name that merely mentions it is fine.
    await expect(publishCourse(map.id, OWNER, "Ana, OryxLearn fan")).resolves.toMatchObject({
      authorName: "Ana, OryxLearn fan",
    });
  });

  it("labels a learner's course built from a sample posting as a sample, and still lists it", async () => {
    const map = await generateSkillMap({ text: SAMPLE_POSTINGS[0].text, kind: "posting", ownerId: OWNER });
    expect(vi.mocked(chatJSON)).not.toHaveBeenCalled();

    expect(await getCourse(map.id, OWNER)).toMatchObject({ published: false, isSample: true });
    const course = await publishCourse(map.id, OWNER, "Ana");
    expect(course.isSample).toBe(true);
    expect((await getCourse(map.id, OTHER)).course?.isSample).toBe(true);

    const listed = (await listCourses({ sort: "new" })).filter((c) => c.title === course.title);
    // The seeded sample and the learner's copy, both labelled.
    expect(listed.map((c) => [c.authorName, c.isSample]).sort()).toEqual([
      ["Ana", true],
      ["OryxLearn team", true],
    ]);
  });

  it("does not label a course from the learner's own posting as a sample", async () => {
    const map = await saveMap(OWNER);
    expect((await publishCourse(map.id, OWNER, "Ana")).isSample).toBe(false);
    expect((await getCourse(map.id, OWNER)).isSample).toBe(false);
  });

  it("republishing keeps publishedAt, recounts likes, and updates the name and updatedAt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-07T10:00:00.000Z"));
      const map = await saveMap(OWNER);
      const first = await publishCourse(map.id, OWNER, "Ana");
      await likeCourse(map.id, OTHER);

      vi.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
      const second = await publishCourse(map.id, OWNER, "Ana L");

      expect(second.publishedAt).toBe(first.publishedAt);
      expect(second.updatedAt).toBe("2026-11-07T12:00:00.000Z");
      expect(second.authorName).toBe("Ana L");
      expect(second.likeCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("unpublishCourse", () => {
  it("removes the listing but keeps likes, so republishing restores the count", async () => {
    const map = await saveMap(OWNER);
    await publishCourse(map.id, OWNER);
    await likeCourse(map.id, OTHER);

    await unpublishCourse(map.id, OWNER);
    expect(await isPublished(map.id)).toBe(false);
    expect(await getDoc(`likes/${map.id}/${OTHER}`)).not.toBeNull();

    expect((await publishCourse(map.id, OWNER)).likeCount).toBe(1);
  });

  it("is owner only, and harmless when already private", async () => {
    const map = await saveMap(OWNER);
    await publishCourse(map.id, OWNER);
    await expectCoursesError(unpublishCourse(map.id, OTHER), 403);
    expect(await isPublished(map.id)).toBe(true);

    await unpublishCourse(map.id, OWNER);
    await expect(unpublishCourse(map.id, OWNER)).resolves.toBeUndefined();
  });
});

describe("getCourse", () => {
  it("shows a private course to its owner, with course null", async () => {
    const map = await saveMap(OWNER);
    const detail = await getCourse(map.id, OWNER);
    expect(detail).toMatchObject({
      course: null,
      title: "Data analyst",
      subtitle: "Calgary",
      published: false,
      isOwner: true,
      likedByMe: false,
    });
  });

  it("answers 404 for a private course to anyone else, the same as a missing map", async () => {
    const map = await saveMap(OWNER);
    await expectCoursesError(getCourse(map.id, OTHER), 404);
    await expectCoursesError(getCourse(randomUUID(), OTHER), 404);
    await expectCoursesError(getCourse("not-a-uuid", OTHER), 404);
  });

  it("shows a published course to anyone, with likedByMe for the viewer", async () => {
    const map = await saveMap(OWNER);
    await publishCourse(map.id, OWNER, "Ana");
    await likeCourse(map.id, OTHER);

    const forOther = await getCourse(map.id, OTHER);
    expect(forOther).toMatchObject({ published: true, isOwner: false, likedByMe: true });
    expect(forOther.course).toMatchObject({ authorName: "Ana", likeCount: 1 });

    const forStranger = await getCourse(map.id, randomUUID());
    expect(forStranger.likedByMe).toBe(false);
  });

  it("lists skills in learning order with only id, title, why and fromSource", async () => {
    const map = await saveMap(OWNER, {
      nodes: [makeNode("joins", ["sql"]), makeNode("sql", [], false)],
    });
    await publishCourse(map.id, OWNER);
    const { skills } = await getCourse(map.id, OTHER);
    expect(skills).toEqual([
      { id: "sql", title: "Skill sql", why: "Why sql matters.", fromSource: false },
      { id: "joins", title: "Skill joins", why: "Why joins matters.", fromSource: true },
    ]);
  });

  it("never includes the owner id or the posting text", async () => {
    const map = await saveMap(OWNER);
    await publishCourse(map.id, OWNER);
    for (const viewer of [OWNER, OTHER]) {
      const text = JSON.stringify(await getCourse(map.id, viewer));
      expect(text).not.toContain(OWNER);
      expect(text).not.toContain("authorId");
      expect(text).not.toContain("ownerId");
      expect(text).not.toContain("secret posting text");
    }
  });
});

describe("listCourses", () => {
  async function publishWith(title: string, likes: number, publishedAt: string, authorName = "Ana") {
    const map = await saveMap(randomUUID(), { title, subtitle: `${title} subtitle` });
    await putDoc(`courses/${map.id}`, {
      mapId: map.id,
      title,
      subtitle: `${title} subtitle`,
      authorId: map.ownerId,
      authorName,
      skillCount: 2,
      likeCount: likes,
      isSample: false,
      publishedAt,
      updatedAt: publishedAt,
    } satisfies CourseListing);
    return map;
  }

  it("includes the seeded samples, labelled as samples, and no private maps", async () => {
    await saveMap(OWNER, { title: "Private one" });
    const courses = await listCourses({ sort: "popular" });
    expect(courses.filter((c) => c.isSample)).toHaveLength(3);
    expect(courses.every((c) => c.authorName === "OryxLearn team")).toBe(true);
    expect(courses.some((c) => c.title === "Private one")).toBe(false);
  });

  it("sorts by likes then newest for popular, and newest first for new", async () => {
    await publishWith("Zeta course", 2, "2030-01-01T00:00:00.000Z");
    await publishWith("Alpha course", 9, "2029-01-01T00:00:00.000Z");
    await publishWith("Beta course", 2, "2031-01-01T00:00:00.000Z");

    const popular = (await listCourses({ sort: "popular" })).map((c) => c.title).slice(0, 3);
    expect(popular).toEqual(["Alpha course", "Beta course", "Zeta course"]);

    const fresh = (await listCourses({ sort: "new" })).map((c) => c.title).slice(0, 3);
    expect(fresh).toEqual(["Beta course", "Zeta course", "Alpha course"]);
  });

  it("filters by q on title, subtitle or author name, trimmed and ignoring case", async () => {
    await publishWith("Welding basics", 0, "2026-11-07T00:00:00.000Z", "Sam");
    await publishWith("Payroll", 0, "2026-11-07T00:00:00.000Z", "Welder Joe");

    expect((await listCourses({ sort: "new", q: "  WELD " })).map((c) => c.title).sort()).toEqual([
      "Payroll",
      "Welding basics",
    ]);
    expect((await listCourses({ sort: "new", q: "basics subtitle" })).map((c) => c.title)).toEqual([
      "Welding basics",
    ]);
    expect(await listCourses({ sort: "new", q: "nothing like this" })).toEqual([]);
  });

  it("never sends authorId or ownerId", async () => {
    const map = await saveMap(OWNER);
    await publishCourse(map.id, OWNER);
    const text = JSON.stringify(await listCourses({ sort: "new" }));
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain("authorId");
    expect(text).not.toContain("ownerId");
    expect(text).not.toContain("oryxlearn-sample-courses");
  });
});

describe("isPublished", () => {
  it("is false for a malformed id without reading the store", async () => {
    expect(await isPublished("courses/../x")).toBe(false);
    expect(await isPublished(randomUUID())).toBe(false);
  });
});
