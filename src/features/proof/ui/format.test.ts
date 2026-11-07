import { describe, expect, it } from "vitest";
import { formatDateTime, formatDuration, highlightSegments, integrityLines, roleLead, sourceName } from "./format";

describe("highlightSegments", () => {
  const text = "An inner join keeps matches. A left join keeps every left row.";

  it("rebuilds the text exactly, with the quote marked", () => {
    const segments = highlightSegments(text, ["keeps matches"]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.filter((segment) => segment.marked).map((segment) => segment.text)).toEqual(["keeps matches"]);
    expect(segments.find((segment) => segment.marked)?.endsCheckpoints).toEqual([1]);
  });

  it("numbers quotes by checkpoint, skipping missed ones", () => {
    const segments = highlightSegments(text, ["inner join", null, "left row"]);
    expect(segments.flatMap((segment) => segment.endsCheckpoints)).toEqual([1, 3]);
  });

  it("matches the way grading does, ignoring case and whitespace", () => {
    const segments = highlightSegments("Keeps  every\nLEFT row today", ["keeps every left row"]);
    expect(segments[0]).toMatchObject({ text: "Keeps  every\nLEFT row", marked: true });
  });

  it("handles overlapping quotes without losing text", () => {
    const segments = highlightSegments(text, ["left join keeps", "keeps every"]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
    expect(segments.filter((segment) => segment.marked).map((segment) => segment.text).join("")).toBe("left join keeps every");
  });

  it("treats regular expression characters as plain text", () => {
    const segments = highlightSegments("Use a+b (or c/d) - really [ok].", ["a+b (or c/d) - really [ok]"]);
    expect(segments[0].marked).toBe(false);
    expect(segments[1]).toMatchObject({ text: "a+b (or c/d) - really [ok]", marked: true });
  });

  it("leaves the text plain when a quote is not there, or there is none", () => {
    expect(highlightSegments(text, ["nothing like this"])).toEqual([{ text, marked: false, endsCheckpoints: [] }]);
    expect(highlightSegments(text, [])).toEqual([{ text, marked: false, endsCheckpoints: [] }]);
  });
});

describe("words on the page", () => {
  it("formats active time", () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(134_000)).toBe("2 min 14 s");
    expect(formatDuration(120_000)).toBe("2 min");
  });

  it("describes signals calmly", () => {
    expect(integrityLines({ pasted: false, activeMs: 134_000, wordCount: 1, inputMethod: "typed" })).toEqual({
      method: "Typed",
      paste: "No paste detected",
      active: "2 min 14 s active",
      words: "1 word",
    });
    expect(integrityLines({ pasted: true, activeMs: 0, wordCount: 90, inputMethod: "voice" })).toEqual({
      method: "Spoken",
      paste: "Some text was pasted",
      active: "Active time not recorded",
      words: "90 words",
    });
  });

  it("gives the same date in every time zone", () => {
    expect(formatDateTime("2026-11-07T18:47:16.560Z")).toBe("November 7, 2026, 18:47 UTC");
  });
});

describe("how the source is named", () => {
  it("says the person supplied it, so it can't read as coming from an employer", () => {
    expect(sourceName({ status: "verified", kind: "posting", quote: "q", page: null })).toBe("From the posting this person supplied");
    expect(sourceName({ status: "verified", kind: "pdf", quote: "q", page: 2 })).toBe("From the PDF this person supplied, page 2");
    expect(roleLead("posting")).toContain("a posting this person supplied");
    expect(roleLead("pdf")).toContain("a PDF this person supplied");
  });
});
