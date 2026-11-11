import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDoc, putDoc } from "@/shared/store";
import { deleteForMaps } from "./deleteData";

let mine: string;
let theirs: string;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mine = randomUUID();
  theirs = randomUUID();
  await putDoc(`quiz/${mine}/a`, { items: [] });
  await putDoc(`quiz/${mine}/b`, { items: [] });
  await putDoc(`quiz/${theirs}/a`, { items: [] });
});

describe("deleteForMaps", () => {
  it("removes the saved questions for the given maps only", async () => {
    await expect(deleteForMaps([mine])).resolves.toBe(2);
    expect(await getDoc(`quiz/${mine}/a`)).toBeNull();
    expect(await getDoc(`quiz/${mine}/b`)).toBeNull();
    expect(await getDoc(`quiz/${theirs}/a`)).not.toBeNull();
  });

  it("can run twice", async () => {
    await deleteForMaps([mine]);
    await expect(deleteForMaps([mine])).resolves.toBe(0);
  });

  it("ignores ids that are not map ids", async () => {
    await expect(deleteForMaps(["", "../", `${theirs}/a`, theirs.slice(0, 8)])).resolves.toBe(0);
    expect(await getDoc(`quiz/${theirs}/a`)).not.toBeNull();
  });
});
