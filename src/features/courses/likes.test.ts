import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDoc, putDoc } from "@/shared/store";
import { getCourse, publishCourse } from "./courses";
import { CoursesError } from "./errors";
import { likeCourse, unlikeCourse } from "./likes";
import { resetStore, saveMap } from "./testing";
import type { CourseListing } from "./types";

const OWNER = randomUUID();

async function expectCoursesError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CoursesError);
  expect((error as CoursesError).status).toBe(status);
}

let mapId: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  resetStore();
  const map = await saveMap(OWNER);
  mapId = map.id;
  await publishCourse(mapId, OWNER, "Ana");
});

/** The live total that readers see: what `likes/<mapId>/_count` holds. */
async function listingLikes(): Promise<number | undefined> {
  return (await getDoc<{ likeCount: number }>(`likes/${mapId}/_count`))?.likeCount;
}

describe("likeCourse", () => {
  it("saves one like document and writes the count beside the likes", async () => {
    const fan = randomUUID();
    expect(await likeCourse(mapId, fan)).toEqual({ liked: true, likeCount: 1 });
    expect(await getDoc(`likes/${mapId}/${fan}`)).toMatchObject({ userId: fan, likedAt: expect.any(String) });
    expect(await listingLikes()).toBe(1);
  });

  it("counts a second like from the same person once, and keeps the first likedAt", async () => {
    const fan = randomUUID();
    await likeCourse(mapId, fan);
    const first = await getDoc<{ likedAt: string }>(`likes/${mapId}/${fan}`);
    expect(await likeCourse(mapId, fan)).toEqual({ liked: true, likeCount: 1 });
    expect(await getDoc(`likes/${mapId}/${fan}`)).toEqual(first);
  });

  it("never loses a like when several arrive together, and the next request settles the count", async () => {
    const fans = [randomUUID(), randomUUID(), randomUUID()];
    await Promise.all(fans.map((fan) => likeCourse(mapId, fan)));
    for (const fan of fans) expect(await getDoc(`likes/${mapId}/${fan}`)).not.toBeNull();
    // A racing recount may write a stale total; any later like or unlike recounts it.
    expect((await unlikeCourse(mapId, randomUUID())).likeCount).toBe(3);
    expect(await listingLikes()).toBe(3);
  });

  it("puts a wrong count right on the next like", async () => {
    await putDoc(`likes/${mapId}/_count`, { likeCount: 42, countedAt: new Date().toISOString() });
    expect((await likeCourse(mapId, randomUUID())).likeCount).toBe(1);
    expect(await listingLikes()).toBe(1);
  });

  it("never writes the listing, so it can't undo an unpublish or a republish", async () => {
    const before = await getDoc<CourseListing>(`courses/${mapId}`);
    const fan = randomUUID();
    await likeCourse(mapId, fan);
    await unlikeCourse(mapId, fan);
    await likeCourse(mapId, randomUUID());
    expect(await getDoc<CourseListing>(`courses/${mapId}`)).toEqual(before);
  });

  it("does not count the running total as a like", async () => {
    await likeCourse(mapId, randomUUID());
    await likeCourse(mapId, randomUUID());
    expect((await likeCourse(mapId, randomUUID())).likeCount).toBe(3);
    expect((await getCourse(mapId, randomUUID())).course?.likeCount).toBe(3);
  });

  it("refuses the owner with a 403", async () => {
    await expectCoursesError(likeCourse(mapId, OWNER), 403);
    expect(await getDoc(`likes/${mapId}/${OWNER}`)).toBeNull();
  });

  it("refuses an unpublished, missing or malformed course with a 404", async () => {
    const privateMap = await saveMap(OWNER);
    await expectCoursesError(likeCourse(privateMap.id, randomUUID()), 404);
    await expectCoursesError(likeCourse(randomUUID(), randomUUID()), 404);
    await expectCoursesError(likeCourse("../maps/x", randomUUID()), 404);
  });

  it("refuses a user id that is not one of ours, before writing anything", async () => {
    await expectCoursesError(likeCourse(mapId, "../../courses/x"), 400);
    expect(await listingLikes()).toBe(0);
  });
});

describe("unlikeCourse", () => {
  it("removes the like and recounts", async () => {
    const fan = randomUUID();
    await likeCourse(mapId, fan);
    await likeCourse(mapId, randomUUID());
    expect(await unlikeCourse(mapId, fan)).toEqual({ liked: false, likeCount: 1 });
    expect(await getDoc(`likes/${mapId}/${fan}`)).toBeNull();
    expect(await listingLikes()).toBe(1);
  });

  it("is harmless for someone who never liked it", async () => {
    expect(await unlikeCourse(mapId, randomUUID())).toEqual({ liked: false, likeCount: 0 });
  });

  it("refuses an unpublished course with a 404", async () => {
    const privateMap = await saveMap(OWNER);
    await expectCoursesError(unlikeCourse(privateMap.id, randomUUID()), 404);
  });
});
