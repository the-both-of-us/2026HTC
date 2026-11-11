import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";
import { classify, rulesFor, run } from "../../../scripts/wipe-courses";

/** The wipe script lives in scripts/, which vitest does not collect, so its tests are here with the other data-deletion tests. */
const deleteSpy = vi.hoisted(() => ({ calls: [] as string[], onDelete: undefined as undefined | (() => void) }));

vi.mock("@/shared/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/shared/store")>();
  return {
    ...original,
    deleteDoc: vi.fn(async (key: string) => {
      deleteSpy.calls.push(key);
      deleteSpy.onDelete?.();
      return original.deleteDoc(key);
    }),
  };
});

const CONTENT = ["maps/m1", "maps-by-owner/u1/m1", "indexes/maps-by-owner-v1", "indexes/programs-by-owner-v1", "programs/p1", "lessons/c1/n1", "catalog/courses/c1", "partial/x", "claims/x", "attempts/u1/m1/n1", "circles/ci1", "review/u1", "proofs/pr1"];
const KEPT_BY_CONTENT = ["accounts/a1", "account-of/s1", "network/profiles/u1", "settings/u1", "streaks/u1", "grid-solves/u1/x", "grid/last-good", "feed-pool/golf", "skill-reels/r1", "skill-reel-votes/v1", "course-seeds/s1"];

async function clearStore() {
  for (const key of await listKeys("")) await deleteDoc(key);
  deleteSpy.calls.length = 0;
  deleteSpy.onDelete = undefined;
}

async function seed(keys: string[]) {
  for (const key of keys) await putDoc(key, { key, n: 1 });
}

const tempDir = () => mkdtempSync(join(tmpdir(), "wipe-test-"));

async function runScript(argv: string[]) {
  const lines: string[] = [];
  const code = await run(argv, (line) => lines.push(line));
  return { code, text: lines.join("\n") };
}

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  await clearStore();
});

describe("wipe-courses dry run", () => {
  it("lists every prefix as delete or keep with its count, and changes nothing", async () => {
    await seed([...CONTENT, ...KEPT_BY_CONTENT]);
    const before = (await listKeys("")).length;

    const { code, text } = await runScript(["--scope", "content"]);

    expect(code).toBe(0);
    expect(text).toContain("Store: memory");
    expect(text).toMatch(/DELETE\s+maps\/\s+1 keys/);
    expect(text).toMatch(/DELETE\s+indexes\/maps-by-owner-v1\s+1 keys/);
    expect(text).toMatch(/KEEP\s+accounts\/\s+1 keys/);
    expect(text).toMatch(/KEEP\s+feed-\s+1 keys/);
    expect(text).toContain(`${CONTENT.length} keys would be deleted, ${KEPT_BY_CONTENT.length} kept, 0 unclassified.`);
    expect(text).toContain("Dry run");
    expect((await listKeys("")).length).toBe(before);
    expect(deleteSpy.calls).toEqual([]);
  });

  it("marks a prefix in neither list as UNCLASSIFIED, and does not mistake a near-name for a known one", async () => {
    await seed(["maps/m1", "mystery/a", "mystery/b", "indexes/something-else", "mapsfoo/x"]);
    const { code, text } = await runScript(["--scope", "content"]);
    expect(code).toBe(0);
    expect(text).toMatch(/UNCLASSIFIED\s+mystery\/\s+2 keys/);
    expect(text).toMatch(/UNCLASSIFIED\s+indexes\/\s+1 keys/);
    expect(text).toMatch(/UNCLASSIFIED\s+mapsfoo\/\s+1 keys/);
  });

  it("classifies the pre-test keys: records, question sets and their generation state are all content", async () => {
    await seed(["pretest/c1/u1", "pretest/c1/u1/lock", "pretest-sets/c1/u1", "claims/pretest-sets/c1/u2", "partial/pretest-sets/c1/u2"]);
    const { code, text } = await runScript(["--scope", "content"]);
    expect(code).toBe(0);
    expect(text).toMatch(/DELETE\s+pretest\/\s+2 keys/);
    expect(text).toMatch(/DELETE\s+pretest-sets\/\s+1 keys/);
    expect(text).toContain("5 keys would be deleted, 0 kept, 0 unclassified.");
    expect(text).not.toContain("UNCLASSIFIED");
  });

  it("gives a key to the longest matching prefix", () => {
    const plan = classify("content", ["circles/c", "catch/x", "catch-revealed/y", "final/z", "final-sets/q"], rulesFor("content"));
    const counts = Object.fromEntries(plan.byRule.filter(({ keys }) => keys.length).map(({ rule, keys }) => [rule.prefix, keys.length]));
    expect(counts).toEqual({ "circles/": 1, "catch/": 1, "catch-revealed/": 1, "final/": 1, "final-sets/": 1 });
    expect(plan.unclassified.size).toBe(0);
  });
});

describe("wipe-courses --confirm", () => {
  it("refuses without --backup, and without a scope", async () => {
    await seed(CONTENT);
    expect((await runScript(["--scope", "content", "--confirm"])).code).toBe(2);
    expect((await runScript(["--confirm", "--backup", tempDir()])).code).toBe(2);
    expect((await runScript(["--scope", "everything"])).code).toBe(2);
    expect((await listKeys("")).length).toBe(CONTENT.length);
  });

  it("refuses while any key is UNCLASSIFIED, before writing a backup or deleting", async () => {
    await seed([...CONTENT, "mystery/a"]);
    const dir = join(tempDir(), "backup");

    const { code, text } = await runScript(["--scope", "content", "--backup", dir, "--confirm"]);

    expect(code).toBe(3);
    expect(text).toContain("UNCLASSIFIED");
    expect(existsSync(dir)).toBe(false);
    expect(deleteSpy.calls).toEqual([]);
    expect((await listKeys("")).length).toBe(CONTENT.length + 1);
  });

  it("writes and verifies the backup before the first delete, then deletes only the content", async () => {
    await seed([...CONTENT, ...KEPT_BY_CONTENT]);
    const dir = join(tempDir(), "backup");
    const backupExistedAtFirstDelete: boolean[] = [];
    deleteSpy.onDelete = () => backupExistedAtFirstDelete.push(existsSync(join(dir, "manifest.json")) && existsSync(join(dir, "maps.jsonl")));

    const { code, text } = await runScript(["--scope", "content", "--backup", dir, "--confirm"]);

    expect(code).toBe(0);
    expect(backupExistedAtFirstDelete.length).toBe(CONTENT.length);
    expect(backupExistedAtFirstDelete.every(Boolean)).toBe(true);
    expect(text).toContain(`Backup verified: ${CONTENT.length} docs`);
    expect(text).toMatch(/deleted\s+1\s+maps\//);

    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.total).toBe(CONTENT.length);
    expect(manifest.files["maps.jsonl"]).toBe(1);
    expect(manifest.files["indexes__maps-by-owner-v1.jsonl"]).toBe(1);
    const mapLines = readFileSync(join(dir, "maps.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(mapLines).toEqual([{ key: "maps/m1", value: { key: "maps/m1", n: 1 } }]);

    expect((await listKeys("")).sort()).toEqual([...KEPT_BY_CONTENT].sort());
  });

  it("is safe to run again: the second run finds nothing to delete", async () => {
    await seed(CONTENT);
    await runScript(["--scope", "content", "--backup", join(tempDir(), "b1"), "--confirm"]);
    deleteSpy.calls.length = 0;
    const second = await runScript(["--scope", "content", "--backup", join(tempDir(), "b2"), "--confirm"]);
    expect(second.code).toBe(0);
    expect(second.text).toContain("0 keys would be deleted");
    expect(deleteSpy.calls).toEqual([]);
  });

  it("deletes nothing when the backup cannot be written or already exists", async () => {
    await seed(CONTENT);
    const used = tempDir();
    writeFileSync(join(used, "manifest.json"), "{}");
    const existing = await runScript(["--scope", "content", "--backup", used, "--confirm"]);
    expect(existing.code).toBe(4);
    expect(existing.text).toContain("already holds a backup");

    const file = join(tempDir(), "a-file");
    writeFileSync(file, "x");
    const notADir = await runScript(["--scope", "content", "--backup", join(file, "inside"), "--confirm"]).catch(() => ({ code: 4 }));
    expect(notADir.code).toBe(4);

    expect(deleteSpy.calls).toEqual([]);
    expect((await listKeys("")).length).toBe(CONTENT.length);
  });
});

describe("wipe-courses all-but-accounts", () => {
  it("also deletes settings, streaks, grid, the feed, reels and seeds; keeps accounts and network; warns about circles", async () => {
    await seed([...CONTENT, ...KEPT_BY_CONTENT]);

    const dry = await runScript(["--scope", "all-but-accounts"]);
    expect(dry.text).toMatch(/KEEP\s+circles\/\s+1 keys/);
    expect(dry.text).toContain("WARNING: circles/ is kept");

    const dir = join(tempDir(), "backup");
    const { code } = await runScript(["--scope", "all-but-accounts", "--backup", dir, "--confirm"]);
    expect(code).toBe(0);
    expect((await listKeys("")).sort()).toEqual(["account-of/s1", "accounts/a1", "circles/ci1", "network/profiles/u1"]);
    expect(await getDoc("settings/u1")).toBeNull();
  });

  it("deletes circles too with --delete-circles", async () => {
    await seed([...CONTENT, ...KEPT_BY_CONTENT]);
    const { code } = await runScript(["--scope", "all-but-accounts", "--delete-circles", "--backup", join(tempDir(), "backup"), "--confirm"]);
    expect(code).toBe(0);
    expect((await listKeys("")).sort()).toEqual(["account-of/s1", "accounts/a1", "network/profiles/u1"]);
  });
});
