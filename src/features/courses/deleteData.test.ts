import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import { deleteUserData } from "./deleteData";

const like = () => ({ userId: "x", likedAt: new Date().toISOString() });
const start = () => ({ copyId: randomUUID(), startedAt: new Date().toISOString() });

let me: string;
let other: string;
let theirCourse: string;
let myCourse: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  me = randomUUID();
  other = randomUUID();
  theirCourse = randomUUID();
  myCourse = randomUUID();

  await putDoc(`likes/${theirCourse}/${me}`, like());
  await putDoc(`likes/${theirCourse}/${other}`, like());
  await putDoc(`likes/${theirCourse}/_count`, { likeCount: 2, countedAt: "" });
  await putDoc(`course-starts/${theirCourse}/${me}`, start());
  await putDoc(`course-starts/${theirCourse}/${other}`, start());

  await putDoc(`likes/${myCourse}/${other}`, like());
  await putDoc(`likes/${myCourse}/_count`, { likeCount: 1, countedAt: "" });
  await putDoc(`course-starts/${myCourse}/${other}`, start());
});

describe("deleteUserData", () => {
  it("removes my likes and starts, and recounts the courses I had liked", async () => {
    const result = await deleteUserData(me);

    expect(result).toEqual({ likes: 1, courseStarts: 1 });
    expect(await getDoc(`likes/${theirCourse}/${me}`)).toBeNull();
    expect(await getDoc(`course-starts/${theirCourse}/${me}`)).toBeNull();
    expect(await getDoc<{ likeCount: number }>(`likes/${theirCourse}/_count`)).toMatchObject({ likeCount: 1 });
  });

  it("leaves everyone else's records alone", async () => {
    await deleteUserData(me);

    expect(await getDoc(`likes/${theirCourse}/${other}`)).not.toBeNull();
    expect(await getDoc(`course-starts/${theirCourse}/${other}`)).not.toBeNull();
    expect(await getDoc(`likes/${myCourse}/${other}`)).not.toBeNull();
  });

  it("clears the likes and starts that point at my own maps, which are about to be deleted", async () => {
    await deleteUserData(me, [myCourse]);

    expect(await listKeys(`likes/${myCourse}/`)).toEqual([]);
    expect(await listKeys(`course-starts/${myCourse}/`)).toEqual([]);
    expect(await getDoc(`likes/${theirCourse}/${other}`)).not.toBeNull();
  });

  it("can run twice", async () => {
    await deleteUserData(me, [myCourse]);
    await expect(deleteUserData(me, [myCourse])).resolves.toEqual({ likes: 0, courseStarts: 0 });
  });

  it("never treats the like total as a user's like", async () => {
    await expect(deleteUserData("_count")).resolves.toEqual({ likes: 0, courseStarts: 0 });
    expect(await getDoc(`likes/${theirCourse}/_count`)).not.toBeNull();
  });

  it("ignores ids that could reach into another prefix", async () => {
    await expect(deleteUserData(`${theirCourse}/${me}`)).resolves.toEqual({ likes: 0, courseStarts: 0 });
    await deleteUserData(other, [`${theirCourse}/x`, ""]);
    expect(await getDoc(`likes/${theirCourse}/${me}`)).not.toBeNull();
  });
});
