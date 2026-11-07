import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimDoc, deleteDoc, getDoc, listDocs, putDoc } from "./index";

// With neither of these set, the in-memory driver is used, so these tests run offline.
beforeEach(() => {
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
});

describe("store (in-memory driver)", () => {
  it("lets exactly one of several callers claim a key, and again once it is deleted", async () => {
    const key = `test/claim-${Math.random()}`;

    const results = await Promise.all([1, 2, 3, 4].map((n) => claimDoc(key, { n })));
    expect(results.filter(Boolean)).toHaveLength(1);

    await deleteDoc(key);
    expect(await claimDoc(key, { n: 5 })).toBe(true);
  });

  it("returns null for a missing key", async () => {
    expect(await getDoc("test/missing")).toBeNull();
  });

  it("reads back what was written, and the newest value after an overwrite", async () => {
    await putDoc("test/a", { n: 1 });
    expect(await getDoc("test/a")).toEqual({ n: 1 });

    await putDoc("test/a", { n: 2 });
    expect(await getDoc("test/a")).toEqual({ n: 2 });
  });

  it("returns a copy, so changing a result does not change the store", async () => {
    await putDoc("test/copy", { n: 1 });
    const doc = await getDoc<{ n: number }>("test/copy");
    doc!.n = 99;
    expect(await getDoc("test/copy")).toEqual({ n: 1 });
  });

  it("lists only the documents under a prefix", async () => {
    await putDoc("list-test/one", { id: "one" });
    await putDoc("list-test/two", { id: "two" });
    await putDoc("other-test/three", { id: "three" });

    const docs = await listDocs<{ id: string }>("list-test/");
    expect(docs.map((doc) => doc.id).sort()).toEqual(["one", "two"]);
  });

  it("deletes a document, and deleting twice is fine", async () => {
    await putDoc("test/gone", { n: 1 });
    await deleteDoc("test/gone");
    await deleteDoc("test/gone");
    expect(await getDoc("test/gone")).toBeNull();
  });
});
