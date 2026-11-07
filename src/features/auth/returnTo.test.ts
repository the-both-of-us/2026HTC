import { describe, expect, it } from "vitest";
import { safeReturnTo, withSignInStatus } from "./returnTo";

describe("safeReturnTo", () => {
  it.each([
    ["/courses", "/courses"],
    ["/courses/abc?sort=new#skills", "/courses/abc?sort=new#skills"],
    ["/", "/"],
    ["/map/x/y", "/map/x/y"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash host", "/\\evil.example"],
    ["backslash later", "/a\\..\\\\evil.example"],
    ["absolute https", "https://evil.example/courses"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["no leading slash", "courses"],
    ["CRLF injection", "/courses\r\nSet-Cookie: x=1"],
    ["LF only", "/a\nb"],
    ["tab inside //", "/\t/evil.example"],
    ["NUL", "/a\u0000b"],
    ["too long", `/${"a".repeat(512)}`],
    ["empty", ""],
    ["not a string", 42],
    ["null", null],
  ])("turns %s into /", (_label, input) => {
    expect(safeReturnTo(input)).toBe("/");
  });

  it("percent-encodes characters outside Latin-1, so the path is always a valid Location header", () => {
    const path = safeReturnTo("/courses/\u4e2d?q=\u00e9#\u4e2d");
    expect(path).toBe("/courses/%E4%B8%AD?q=%C3%A9#%E4%B8%AD");
    expect(() => new Response(null, { status: 303, headers: { Location: path } })).not.toThrow();
  });

  it("re-checks a path whose dot segments resolve to //host", () => {
    expect(safeReturnTo("/.//evil.example")).toBe("/");
    expect(safeReturnTo("/a/..//evil.example")).toBe("/");
  });

  it("allows exactly 512 characters", () => {
    const path = `/${"a".repeat(511)}`;
    expect(safeReturnTo(path)).toBe(path);
  });
});

describe("withSignInStatus", () => {
  it("adds the status and keeps the path's own query and hash", () => {
    expect(withSignInStatus("/courses/1?sort=new#top", "failed")).toBe("/courses/1?sort=new&signin=failed#top");
  });

  it("replaces an existing status", () => {
    expect(withSignInStatus("/?signin=failed", "expired")).toBe("/?signin=expired");
  });

  it("falls back to the home page for an unsafe path", () => {
    expect(withSignInStatus("//evil.example", "failed")).toBe("/?signin=failed");
  });
});
