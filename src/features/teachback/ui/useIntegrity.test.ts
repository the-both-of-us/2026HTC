import { describe, expect, it } from "vitest";
import { createIntegrity } from "./useIntegrity";

describe("how an explanation was written", () => {
  it("is voice only when every word was spoken", () => {
    const integrity = createIntegrity();
    integrity.recordSpeaking(20_000);
    expect(integrity.signalsFor("one two three")).toMatchObject({ inputMethod: "voice", activeMs: 20_000 });
  });

  it("is typed once anything was typed, even a fix to dictated words", () => {
    const integrity = createIntegrity();
    integrity.recordSpeaking(20_000);
    integrity.recordTyping();
    expect(integrity.signalsFor("one two three").inputMethod).toBe("typed");
  });

  it("starts fresh when the box is emptied, and keeps the rule across a reload", () => {
    const integrity = createIntegrity();
    integrity.recordTyping();
    integrity.reset();
    integrity.recordSpeaking(5_000);
    expect(integrity.signalsFor("words").inputMethod).toBe("voice");

    const typedThenReloaded = createIntegrity({ pasted: false, usedVoice: true, typed: true, activeMs: 1_000 });
    expect(typedThenReloaded.signalsFor("words").inputMethod).toBe("typed");
  });
});
