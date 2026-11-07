import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDoc, getDoc, listDocs, putDoc, putDocIfAbsent } from "./index";

// An empty token selects the in-memory driver, so these tests run offline.
beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
});

describe("store (in-memory driver)", () => {
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

  it("lets only one caller claim a key, and leaves the first value alone", async () => {
    const results = await Promise.all([1, 2, 3].map((n) => putDocIfAbsent("test/claim", { n })));
    expect(results).toEqual([true, false, false]);
    expect(await getDoc("test/claim")).toEqual({ n: 1 });
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
