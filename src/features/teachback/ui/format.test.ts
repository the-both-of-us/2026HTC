import { describe, expect, it } from "vitest";
import type { Attempt, Grade } from "@/shared/types";
import { MIN_EXPLANATION_WORDS } from "../attempts";
import {
  formatDuration,
  MIN_WORDS,
  integritySentence,
  nextStepSentence,
  scoreBreakdown,
  secondsText,
  verdictTitle,
  wordCountMessage,
} from "./format";

function grade(met: number, total: number, errors: string[] = []): Grade {
  return {
    score: 0,
    rejectedQuotes: 0,
    misconceptions: errors,
    checkpoints: Array.from({ length: total }, (_, index) => ({
      checkpoint: `checkpoint ${index}`,
      met: index < met,
      quote: index < met ? "words" : null,
    })),
  };
}

function attempt(overrides: Partial<Attempt>): Attempt {
  return {
    id: "a1",
    mapId: "m1",
    nodeId: "n1",
    ownerId: "o1",
    explanation: "text",
    integrity: { pasted: false, activeMs: 0, wordCount: 20, inputMethod: "typed" },
    grade: grade(3, 3),
    followUp: null,
    status: "not-yet",
    createdAt: "2026-11-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("word count message", () => {
  it("uses the same minimum as the server", () => {
    expect(MIN_WORDS).toBe(MIN_EXPLANATION_WORDS);
  });

  it("says how many more words are needed, then that the minimum is met", () => {
    expect(wordCountMessage(1)).toBe("1 word. 14 more to reach the 15-word minimum.");
    expect(wordCountMessage(15)).toBe("15 words. The 15-word minimum is met.");
  });
});

describe("scoreBreakdown", () => {
  it("states the checkpoints met", () => {
    expect(scoreBreakdown(attempt({ grade: grade(2, 3) }), 3)).toBe("2 of 3 checkpoints met.");
  });

  it("states the deduction for factual errors", () => {
    expect(scoreBreakdown(attempt({ grade: grade(2, 3, ["a", "b"]) }), 3)).toBe(
      "2 of 3 checkpoints met, minus 40 for 2 factual errors.",
    );
  });

  it("takes the total from the skill while the server holds back missed checkpoints", () => {
    // The server sends only the 3 met checkpoints of 4 until the follow-up is answered.
    const open = attempt({ status: "needs-followup", grade: grade(3, 3) });
    expect(scoreBreakdown(open, 4)).toBe(
      "3 of 4 checkpoints met. The full breakdown comes after your answer.",
    );
  });
});

describe("verdict and next step", () => {
  it("counts missed checkpoints when the attempt is not yet proven", () => {
    const missing = attempt({ grade: grade(2, 4, ["wrong"]) });
    expect(verdictTitle(missing)).toBe("Not yet. 2 checkpoints to add.");
    expect(nextStepSentence(missing)).toBe(
      "To reach 65, add the 2 missed checkpoints and correct 1 factual error. Your text is kept below for editing.",
    );
  });

  it("points at the error when every checkpoint was met", () => {
    const allMet = attempt({ grade: grade(3, 3, ["wrong", "wrong", "wrong"]) });
    expect(verdictTitle(allMet)).toBe("Not yet. 3 things to correct.");
    expect(nextStepSentence(allMet)).toContain("correct 3 factual errors");
  });

  it("names the follow-up when that is what failed", () => {
    const failed = attempt({
      followUp: { question: "q", answer: "a", passed: false, feedback: "f" },
    });
    expect(verdictTitle(failed)).toBe("Not yet. That answer left a gap.");
    expect(nextStepSentence(failed)).toContain("new question");
  });

  it("covers the other two statuses", () => {
    expect(verdictTitle(attempt({ status: "proven" }))).toBe("Proven");
    expect(verdictTitle(attempt({ status: "needs-followup" }))).toContain("One question left");
  });
});

describe("integrity wording", () => {
  it("formats durations in plain words", () => {
    expect(formatDuration(200)).toBe("under a second");
    expect(formatDuration(48_000)).toBe("48 seconds");
    expect(formatDuration(120_000)).toBe("2 minutes");
    expect(formatDuration(125_000)).toBe("2 minutes 5 seconds");
  });

  it("states the signals plainly", () => {
    expect(
      integritySentence({ pasted: true, activeMs: 1000, wordCount: 30, inputMethod: "typed" }),
    ).toBe("Typed, 30 words, 1 second of active typing, includes pasted text.");
    expect(
      integritySentence({ pasted: false, activeMs: 60_000, wordCount: 1, inputMethod: "voice" }),
    ).toBe("Spoken, 1 word, 1 minute of active speaking and typing, nothing pasted.");
  });
});

describe("secondsText", () => {
  it("shows a measured time to one decimal", () => {
    expect(secondsText(534)).toBe("0.5 s");
    expect(secondsText(1_260)).toBe("1.3 s");
    expect(secondsText(0)).toBe("0.0 s");
  });
});
