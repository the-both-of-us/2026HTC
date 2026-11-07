import { describe, expect, it } from "vitest";
import raw from "./fixtures/statcan-unemployment.json";
import { monthName, parseLatest, quarterName } from "./parse";

describe("parseLatest (saved real StatCan response, 2026-11-07)", () => {
  const parsed = parseLatest(raw);
  it("finds Canada, Alberta and Calgary", () => {
    expect(parsed.get(2062815)?.value).toBe(6.7);
    expect(parsed.get(2064516)?.value).toBe(7.3);
    expect(parsed.get(1643280342)?.value).toBe(6.6);
  });
  it("takes the newest period", () => {
    expect(parsed.get(2064516)?.period).toBe("2026-10");
  });
  it("ignores failures and junk", () => {
    expect(parseLatest(null).size).toBe(0);
    expect(parseLatest([{ status: "FAILED" }]).size).toBe(0);
  });
  it("names periods", () => {
    expect(monthName("2026-10")).toBe("October 2026");
    expect(quarterName("2026-04")).toBe("Q2 2026");
  });
});
