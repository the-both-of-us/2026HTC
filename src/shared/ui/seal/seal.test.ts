import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SEAL_DETAIL, sealDrawing, sealSize, toSealHex, type SealDetail } from "./guilloche";
import { sha256Hex } from "./sha256";

/** Characters of path data allowed per seal, so ten seals on a map stay light. */
const BUDGET: Record<SealDetail, number> = { node: 24_000, mid: 52_000, big: 125_000, hero: 255_000 };

describe("sha256Hex", () => {
  it("matches node's SHA-256", () => {
    for (const text of ["", "oryxlearn", "SQL query writing", "é ✓ 中文", "x".repeat(200)]) {
      expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });
});

describe("sealDrawing", () => {
  it("draws the same seal for the same fingerprint", () => {
    const a = JSON.stringify(sealDrawing("sql-queries", { detail: "mid", kind: "struck" }));
    const b = JSON.stringify(sealDrawing("sql-queries", { detail: "mid", kind: "struck" }));
    expect(a).toBe(b);
  });

  it("memoises: a repeat call returns the same object", () => {
    expect(sealDrawing("abc")).toBe(sealDrawing("abc"));
  });

  it("draws different seals for different fingerprints", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(sealDrawing(`skill-${i}`).lines[1].d);
    expect(seen.size).toBe(40);
  });

  it("uses a SHA-256 hex fingerprint as it is, and hashes anything else", () => {
    const hex = sha256Hex("record");
    expect(toSealHex(hex)).toBe(hex);
    expect(toSealHex(hex.toUpperCase())).toBe(hex);
    expect(toSealHex("record")).toBe(hex);
    expect(sealDrawing(hex)).toBe(sealDrawing("record"));
  });

  it("writes only finite numbers into the paths", () => {
    for (const kind of ["struck", "ink", "white"] as const) {
      const d = sealDrawing("finite", { kind, micro: true });
      for (const path of [d.band.d, ...d.lines.map((l) => l.d)]) expect(path).not.toMatch(/NaN|Infinity/);
    }
  });

  it("keeps foil for proven seals only", () => {
    expect(sealDrawing("f", { kind: "struck" }).lines.some((l) => l.paint === "foil")).toBe(true);
    expect(sealDrawing("f", { kind: "ink" }).lines.some((l) => l.paint === "foil")).toBe(false);
    expect(sealDrawing("f", { kind: "white" }).lines.some((l) => l.paint === "foil")).toBe(false);
  });

  it("stays inside the size budget at every detail level", () => {
    for (const detail of Object.keys(SEAL_DETAIL) as SealDetail[]) {
      let largest = 0;
      for (let i = 0; i < 120; i++) {
        largest = Math.max(largest, sealSize(sealDrawing(`budget-${i}`, { detail, center: detail === "hero" ? 38 : 27 })));
      }
      expect(largest, detail).toBeLessThanOrEqual(BUDGET[detail]);
    }
  });

  it("caps the number of paths per seal", () => {
    const d = sealDrawing("count", { detail: "hero", micro: true });
    expect(d.lines.length + 1).toBeLessThanOrEqual(8);
  });
});
