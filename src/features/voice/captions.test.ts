import { describe, expect, it } from "vitest";
import { estimateSeconds, spokenWordCount, splitWords } from "./captions";

const words = splitWords("Why does the transformer heat up, and what limits its load?");

describe("spokenWordCount", () => {
  it("starts at zero and reaches every word at the real end", () => {
    expect(spokenWordCount(words, 0, 5)).toBe(0);
    expect(spokenWordCount(words, 5, 5)).toBe(words.length);
    expect(spokenWordCount(words, 9, 5)).toBe(words.length);
  });

  it("only ever moves forward", () => {
    let last = 0;
    for (let t = 0; t <= 5; t += 0.1) {
      const count = spokenWordCount(words, t, 5);
      expect(count).toBeGreaterThanOrEqual(last);
      last = count;
    }
  });

  it("holds the last word back while the length is only an estimate", () => {
    const long = estimateSeconds(words) * 3;
    expect(spokenWordCount(words, long, null)).toBe(words.length - 1);
    expect(spokenWordCount(words, long, Infinity)).toBe(words.length - 1);
  });

  it("is roughly half way at the half way mark", () => {
    const count = spokenWordCount(words, 2.5, 5);
    expect(count).toBeGreaterThan(words.length * 0.3);
    expect(count).toBeLessThan(words.length * 0.7);
  });

  it("handles empty text", () => {
    expect(spokenWordCount([], 2, 5)).toBe(0);
  });
});

describe("estimateSeconds", () => {
  it("gives a normal reading length", () => {
    const seconds = estimateSeconds(words);
    expect(seconds).toBeGreaterThan(3);
    expect(seconds).toBeLessThan(8);
  });
});
