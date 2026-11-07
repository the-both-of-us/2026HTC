import { describe, expect, it } from "vitest";
import { checkContactUrl, checkProfileInput, firstError } from "./rules";

function errorsOf(input: Parameters<typeof checkProfileInput>[0]) {
  const result = checkProfileInput(input);
  return result.ok ? {} : result.errors;
}

describe("profile rules", () => {
  it("cleans the name like a course author name", () => {
    const result = checkProfileInput({ displayName: "  Ana \u0000  Lopez\n", city: " Calgary ", lookingFor: null });
    expect(result).toEqual({
      ok: true,
      value: { displayName: "Ana Lopez", city: "Calgary", lookingFor: "", contactUrl: null },
    });
  });

  it("needs a name of 1 to 40 characters with a letter or digit, and not OryxLearn team", () => {
    expect(errorsOf({ displayName: "" }).displayName).toMatch(/enter the name/);
    expect(errorsOf({ displayName: " -- " }).displayName).toMatch(/enter the name/);
    expect(errorsOf({ displayName: "a".repeat(41) }).displayName).toMatch(/40 characters/);
    expect(checkProfileInput({ displayName: "a".repeat(40) }).ok).toBe(true);
    // An emoji counts as one character.
    expect(checkProfileInput({ displayName: `${"a".repeat(39)}🙂` }).ok).toBe(true);
    expect(errorsOf({ displayName: "Oryx-Learn TEAM" }).displayName).toMatch(/kept for OryxLearn/);
  });

  it("limits the city to 40 and Looking for to 120 characters", () => {
    expect(errorsOf({ displayName: "Ana", city: "c".repeat(41) }).city).toMatch(/40 characters/);
    expect(errorsOf({ displayName: "Ana", lookingFor: "l".repeat(121) }).lookingFor).toMatch(/120 characters/);
    expect(checkProfileInput({ displayName: "Ana", city: "c".repeat(40), lookingFor: "l".repeat(120) }).ok).toBe(true);
  });

  it("accepts only https contact links", () => {
    expect(checkContactUrl("https://www.linkedin.com/in/ana")).toEqual({ value: "https://www.linkedin.com/in/ana" });
    expect(checkContactUrl("")).toEqual({ value: null });
    expect(checkContactUrl("   ")).toEqual({ value: null });
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://example.com",
      "ftp://example.com",
      "linkedin.com/in/ana",
      "//example.com",
      "https://",
      "https://user:pass@example.com",
    ]) {
      expect(checkContactUrl(bad), bad).toHaveProperty("error");
    }
  });

  it("limits the contact link to 200 characters", () => {
    const long = `https://example.com/${"a".repeat(181)}`;
    expect(long.length).toBe(201);
    expect(checkContactUrl(long)).toHaveProperty("error");
    expect(checkContactUrl(long.slice(0, 200))).toEqual({ value: long.slice(0, 200) });
  });

  it("reports every field problem, and the first in form order", () => {
    const errors = errorsOf({ displayName: "", contactUrl: "javascript:alert(1)" });
    expect(Object.keys(errors).sort()).toEqual(["contactUrl", "displayName"]);
    expect(firstError(errors)).toBe(errors.displayName);
  });
});
