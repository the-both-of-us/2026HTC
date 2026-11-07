import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId } from "@/shared/identity";
import * as store from "@/shared/store";
import { accountKey, accountOfKey, displayNameFrom, linkAccount, subHash, type AccountDoc } from "./accounts";
import { newDefaultBrowser, resetMemoryStore, stubAuthEnv } from "./testing";

vi.mock("next/headers", async () => (await import("./testing")).nextHeadersMock);
vi.mock("@/shared/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/store")>();
  return { ...real, claimDoc: vi.fn(real.claimDoc) };
});

beforeEach(() => {
  stubAuthEnv();
  resetMemoryStore();
  newDefaultBrowser();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(store.claimDoc).mockReset();
});

describe("displayNameFrom", () => {
  it.each([
    [{ name: "Ana Lopez", nickname: "ana", email: "ana@x.example" }, "Ana Lopez"],
    [{ nickname: "ana", email: "ana@x.example" }, "ana"],
    [{ email: "bo.smith@x.example" }, "bo.smith"],
    [{}, "Learner"],
    [{ name: "   " }, "Learner"],
    [{ name: "ana@x.example" }, "ana"],
    [{ name: "Ana\u0000\u0007 \n\t Lopez‮" }, "Ana Lopez"],
    [{ name: "A".repeat(80) }, "A".repeat(40)],
    [{ name: "\u0000", nickname: "nick" }, "nick"],
  ])("%o shows as %s", (claims, expected) => {
    expect(displayNameFrom(claims)).toBe(expected);
  });
});

describe("linkAccount", () => {
  it("uses the winner's id when another sign-in claims the account first, and frees the id it reserved", async () => {
    const winnerId = "33333333-3333-4333-8333-333333333333";
    const guestId = await getUserId();
    const claim = vi.mocked(store.claimDoc);
    const realClaim = claim.getMockImplementation()!;
    claim.mockImplementation(async (key, value) => {
      if (key !== accountKey(subHash("auth0|x"))) return realClaim(key, value);
      // Another server links the same account between our read and our claim.
      await store.putDoc(key, { userId: winnerId, sub: "auth0|x", createdAt: "then" } satisfies AccountDoc);
      return false;
    });

    expect(await linkAccount("auth0|x")).toBe(winnerId);
    expect(await store.getDoc(accountOfKey(winnerId))).toEqual({ subHash: subHash("auth0|x") });
    // The guest's own id is not left marked as account x's.
    expect(await store.getDoc(accountOfKey(guestId))).toBeNull();
  });

  it("claims the id atomically: two accounts signing in at once with one guest id never share it", async () => {
    const guestId = await getUserId();
    const results = await Promise.all([linkAccount("auth0|a"), linkAccount("auth0|b")]);
    expect(results).toContain(guestId);
    expect(new Set(results).size).toBe(2);
    const docA = await store.getDoc<AccountDoc>(accountKey(subHash("auth0|a")));
    const docB = await store.getDoc<AccountDoc>(accountKey(subHash("auth0|b")));
    expect(docA?.userId).not.toBe(docB?.userId);
    for (const [doc, sub] of [[docA, "auth0|a"], [docB, "auth0|b"]] as const) {
      expect(await store.getDoc(accountOfKey(doc!.userId))).toEqual({ subHash: subHash(sub) });
    }
  });

  it("a write that fails halfway still keeps the id for that account, never for another", async () => {
    const guestId = await getUserId();
    const claim = vi.mocked(store.claimDoc);
    const realClaim = claim.getMockImplementation()!;
    claim.mockImplementationOnce(realClaim).mockImplementationOnce(async () => {
      throw new Error("S3 503");
    });
    await expect(linkAccount("auth0|a")).rejects.toThrow("S3 503");

    // Account B, from the same browser, must not get the id account A half-linked.
    const idB = await linkAccount("auth0|b");
    expect(idB).not.toBe(guestId);
    // Account A, trying again, gets it.
    expect(await linkAccount("auth0|a")).toBe(guestId);
    expect((await store.getDoc<AccountDoc>(accountKey(subHash("auth0|a"))))?.userId).toBe(guestId);
  });

  it("keys accounts by the hash of sub, never sub itself", async () => {
    await linkAccount("google-oauth2|12345");
    const keys = [...((globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.keys() ?? [])];
    expect(keys).toContain(accountKey(subHash("google-oauth2|12345")));
    expect(keys.join(" ")).not.toContain("12345");
    expect(subHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
