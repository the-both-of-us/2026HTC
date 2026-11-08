import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { putDoc } from "@/shared/store";
import { isAdminToken, isLockedOut, makeAdminToken, passcodeMatches, recordFailure, resetFailures } from "./auth";
import { accountKind, loadAdminOverview } from "./overview";

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("ADMIN_PASSCODE", "test-pass");
  resetFailures();
});

describe("admin passcode", () => {
  it("accepts only the passcode from the environment", () => {
    expect(passcodeMatches("test-pass")).toBe(true);
    expect(passcodeMatches(" test-pass ")).toBe(true);
    expect(passcodeMatches("test-pas")).toBe(false);
    expect(passcodeMatches("")).toBe(false);
  });

  it("is off with no passcode set", () => {
    vi.stubEnv("ADMIN_PASSCODE", "");
    expect(passcodeMatches("")).toBe(false);
    expect(makeAdminToken()).toBeNull();
  });

  it("signs a token that expires, and that a new passcode cancels", () => {
    const now = 1_800_000_000_000;
    const token = makeAdminToken(now)!;
    expect(isAdminToken(token, now + 1000)).toBe(true);
    expect(isAdminToken(token, now + 9 * 3_600_000)).toBe(false);
    expect(isAdminToken(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now)).toBe(false);
    expect(isAdminToken(`${now + 999_999}.${token.split(".")[1]}`, now)).toBe(false);
    vi.stubEnv("ADMIN_PASSCODE", "another");
    expect(isAdminToken(token, now + 1000)).toBe(false);
  });

  it("locks an address out after 5 wrong tries for 10 minutes", () => {
    const now = 1_800_000_000_000;
    for (let i = 0; i < 5; i++) recordFailure("1.2.3.4", now);
    expect(isLockedOut("1.2.3.4", now)).toBe(true);
    expect(isLockedOut("5.6.7.8", now)).toBe(false);
    expect(isLockedOut("1.2.3.4", now + 11 * 60_000)).toBe(false);
  });
});

describe("admin overview", () => {
  it("names the sign-in provider", () => {
    expect(accountKind("google-oauth2|123")).toBe("Google");
    expect(accountKind("auth0|abc")).toBe("Email");
  });

  it("gathers each person's maps, programs, account, profile and interests", async () => {
    const [ada, guest] = [randomUUID(), randomUUID()];
    const mapId = randomUUID();
    const node = (id: string) => ({ id, title: id, why: "", checkpoints: [], prerequisites: [], citation: null, fromSource: false });
    await putDoc(`maps/${mapId}`, {
      id: mapId,
      ownerId: ada,
      title: "Volcanoes",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "volcanoes for grade 3",
      nodes: [node("a"), node("b")],
      createdAt: "2026-11-08T05:00:00.000Z",
    });
    await putDoc(`progress/${mapId}/${ada}/a`, { at: "x" });
    await putDoc(`courses/${mapId}`, { mapId, authorId: ada, authorName: "Ada" });
    await putDoc(`accounts/hash-${ada}`, { userId: ada, sub: "google-oauth2|1", createdAt: "2026-11-07T00:00:00.000Z" });
    await putDoc(`feed-interests/${guest}`, { interests: [{ slug: "game-theory", name: "Game theory" }], updatedAt: "x" });
    await putDoc(`maps/${randomUUID()}`, { broken: true });

    const overview = await loadAdminOverview();
    const first = overview.users.find((user) => user.id === ada)!;
    expect(first).toMatchObject({ account: "Google", name: "Ada" });
    expect(first.maps[0]).toMatchObject({ title: "Volcanoes", typed: "volcanoes for grade 3", proven: 1, skills: 2, published: true });
    expect(overview.users.find((user) => user.id === guest)?.interests).toEqual(["Game theory"]);
    expect(overview.searches.find((search) => search.userId === ada)).toMatchObject({ typed: "volcanoes for grade 3", what: "map" });
  });
});
