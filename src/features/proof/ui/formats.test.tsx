import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProofSkill } from "../types";
import { provedByLine } from "./format";
import { SkillEvidence } from "./SkillEvidence";

const base: ProofSkill = {
  nodeId: "photo",
  title: "Photosynthesis",
  why: "How plants eat.",
  score: 100,
  explanation: "Sentence 2: It needs sunlight in the day.",
  checkpoints: [{ checkpoint: "Needs sunlight", quote: "It needs sunlight in the day.", met: true }],
  factualErrors: [],
  rejectedQuotes: 0,
  followUp: { question: "", answer: "", feedback: "" },
  integrity: { pasted: false, activeMs: 20_000, wordCount: 7, inputMethod: "typed" },
  source: { status: "topic" },
  attemptedAt: "2026-11-07T12:00:00.000Z",
};

const caught: ProofSkill = {
  ...base,
  format: "catch",
  catch: {
    sentences: ["Plants make food.", "They do it at night."],
    planted: [{ sentence: 2, why: "It needs sunlight." }],
    picks: [{ sentence: 2, correction: "It needs sunlight in the day.", fixed: true }],
  },
};

describe("how a skill was proved, on the evidence page", () => {
  it("says honestly which format each skill was proved in", () => {
    expect(provedByLine(caught)).toBe("Caught 1 planted mistake in an AI explanation");
    expect(provedByLine({ ...base, format: "kid", readingGrade: 5.6 })).toBe(
      "Explained it for a 10-year-old, reading grade 6 measured by code",
    );
    expect(provedByLine({ ...base, format: "timed", integrity: { ...base.integrity, inputMethod: "voice" } })).toBe(
      "Explained it aloud against a 30-second clock",
    );
    // A record from before formats existed.
    expect(provedByLine(base)).toBe("Explained it in writing, in their own words");
  });

  it("shows a caught mistake's round instead of a follow-up", () => {
    const html = renderToStaticMarkup(<SkillEvidence skill={caught} />);
    // Counts only, even if a full round (an older record) reaches the component.
    expect(html).toContain("Caught 1 of 1 planted mistake.");
    expect(html).not.toContain("They do it at night");
    expect(html).not.toContain("It needs sunlight.");
    expect(html).not.toContain("Live follow-up question");
  });
});
