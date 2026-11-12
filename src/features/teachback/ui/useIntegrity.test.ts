import { describe, expect, it } from "vitest";
import { createIntegrity } from "./useIntegrity";

describe("how an explanation was written", () => {
  it("counts the words and the time between keystrokes, and never claims voice", () => {
    const integrity = createIntegrity({ pasted: false, activeMs: 20_000 });
    expect(integrity.signalsFor("one two three")).toEqual({ pasted: false, activeMs: 20_000, wordCount: 3 });
  });

  it("starts fresh when the box is emptied, and keeps a paste across a reload", () => {
    const integrity = createIntegrity({ pasted: true, activeMs: 1_000 });
    expect(integrity.toSave()).toEqual({ pasted: true, activeMs: 1_000 });
    integrity.reset();
    expect(integrity.toSave()).toEqual({ pasted: false, activeMs: 0 });
  });
});
