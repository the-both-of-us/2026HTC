import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openTransaction, sealTransaction, TX_COOKIE, type Transaction } from "./transaction";

const SECRET = "fake-transaction-secret-0123456789abcdef";
const NOW = 1_800_000_000_000;

const TX: Transaction = { state: "s", nonce: "n", verifier: "v", returnTo: "/courses", createdAt: NOW };

describe("sign-in transaction cookie", () => {
  it("round-trips a signed transaction", () => {
    expect(openTransaction(sealTransaction(TX, SECRET), SECRET, NOW + 1000)).toEqual(TX);
  });

  it("rejects a missing or malformed value", () => {
    expect(openTransaction(undefined, SECRET, NOW)).toBeNull();
    expect(openTransaction("", SECRET, NOW)).toBeNull();
    expect(openTransaction("no-signature", SECRET, NOW)).toBeNull();
    expect(openTransaction(".abc", SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const sealed = sealTransaction(TX, SECRET);
    const [, signature] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...TX, returnTo: "/evil" })).toString("base64url");
    expect(openTransaction(`${forged}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered signature and a different secret", () => {
    const sealed = sealTransaction(TX, SECRET);
    expect(openTransaction(`${sealed.slice(0, -2)}xx`, SECRET, NOW)).toBeNull();
    expect(openTransaction(sealed, "another-secret-another-secret-0000", NOW)).toBeNull();
  });

  it("rejects a value signed for another cookie name", () => {
    const payload = Buffer.from(JSON.stringify(TX)).toString("base64url");
    const otherName = createHmac("sha256", SECRET).update(`pf_uid:${payload}`).digest("base64url");
    expect(openTransaction(`${payload}.${otherName}`, SECRET, NOW)).toBeNull();
    const right = createHmac("sha256", SECRET).update(`${TX_COOKIE}:${payload}`).digest("base64url");
    expect(openTransaction(`${payload}.${right}`, SECRET, NOW)).toEqual(TX);
  });

  it("expires after ten minutes, and rejects one from the future", () => {
    const sealed = sealTransaction(TX, SECRET);
    expect(openTransaction(sealed, SECRET, NOW + 600_000)).toEqual(TX);
    expect(openTransaction(sealed, SECRET, NOW + 600_001)).toBeNull();
    expect(openTransaction(sealed, SECRET, NOW - 120_000)).toBeNull();
  });

  it("rejects a signed value with the wrong shape", () => {
    const payload = Buffer.from(JSON.stringify({ state: "s" })).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(`${TX_COOKIE}:${payload}`).digest("base64url");
    expect(openTransaction(`${payload}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("re-checks returnTo on the way out", () => {
    const sealed = sealTransaction({ ...TX, returnTo: "//evil.example" }, SECRET);
    expect(openTransaction(sealed, SECRET, NOW)?.returnTo).toBe("/");
  });
});
