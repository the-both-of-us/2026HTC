import { describe, expect, it } from "vitest";
import { CoursesError } from "./errors";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import {
  isSamplePostingText,
  learningOrder,
  matchesQuery,
  normalizeAuthorName,
  normalizeQuery,
  SEED_AUTHOR_NAME,
  sortListings,
} from "./rules";
import { makeNode } from "./testing";
import type { CourseListing } from "./types";

function listing(overrides: Partial<CourseListing>): CourseListing {
  return {
    mapId: "m",
    title: "Title",
    subtitle: "",
    authorId: "secret",
    authorName: "Ana",
    skillCount: 3,
    likeCount: 0,
    isSample: false,
    publishedAt: "2026-11-07T10:00:00.000Z",
    updatedAt: "2026-11-07T10:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeAuthorName", () => {
  it("trims, collapses whitespace and removes control characters", () => {
    expect(normalizeAuthorName("  Ana \n\t Lopez  ")).toBe("Ana Lopez");
    expect(normalizeAuthorName("Ana\u0000Lopez")).toBe("Ana Lopez");
  });

  it("defaults to Anonymous learner when empty or missing", () => {
    expect(normalizeAuthorName("")).toBe("Anonymous learner");
    expect(normalizeAuthorName("   ")).toBe("Anonymous learner");
    expect(normalizeAuthorName(undefined)).toBe("Anonymous learner");
    expect(normalizeAuthorName(null)).toBe("Anonymous learner");
  });

  it("allows 40 characters and refuses 41 with a 400 sentence", () => {
    expect(normalizeAuthorName("a".repeat(40))).toBe("a".repeat(40));
    expect(() => normalizeAuthorName("a".repeat(41))).toThrow(CoursesError);
    try {
      normalizeAuthorName("a".repeat(41));
    } catch (error) {
      expect((error as CoursesError).status).toBe(400);
      expect((error as CoursesError).message).toMatch(/40 characters/);
    }
  });

  it("counts an emoji as one character", () => {
    expect(normalizeAuthorName("😀".repeat(40))).toBe("😀".repeat(40));
  });
});

describe("reserved names", () => {
  it("refuses the sample courses' name however it is spelled, with a 400 sentence", () => {
    for (const name of [SEED_AUTHOR_NAME, "oryxlearn team", "Oryx Learn  Team", "ORYX-LEARN.team"]) {
      let caught: unknown;
      try {
        normalizeAuthorName(name);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CoursesError);
      expect((caught as CoursesError).status).toBe(400);
      expect((caught as CoursesError).message).toMatch(/\.$/);
    }
  });

  it("allows names that only contain part of it", () => {
    expect(normalizeAuthorName("OryxLearn fan")).toBe("OryxLearn fan");
    expect(normalizeAuthorName("Team Ana")).toBe("Team Ana");
  });
});

describe("isSamplePostingText", () => {
  it("is true for each sample posting, ignoring outer whitespace", () => {
    for (const sample of SAMPLE_POSTINGS) {
      expect(isSamplePostingText(sample.text)).toBe(true);
      expect(isSamplePostingText(`\n  ${sample.text}  \n`)).toBe(true);
    }
  });

  it("is false for other text, an edited sample, or nothing", () => {
    expect(isSamplePostingText("A real posting I pasted")).toBe(false);
    expect(isSamplePostingText(`${SAMPLE_POSTINGS[0].text} Also: Rust.`)).toBe(false);
    expect(isSamplePostingText("")).toBe(false);
    expect(isSamplePostingText(undefined)).toBe(false);
  });
});

describe("normalizeQuery and matchesQuery", () => {
  it("trims, lowercases and caps the query at 100 characters", () => {
    expect(normalizeQuery("  SQL  ")).toBe("sql");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
    expect(normalizeQuery(undefined)).toBe("");
  });

  it("matches title, subtitle or author name, ignoring case", () => {
    const course = listing({ title: "Junior Backend", subtitle: "Calgary, AB", authorName: "Ana" });
    expect(matchesQuery(course, "backend")).toBe(true);
    expect(matchesQuery(course, "calgary")).toBe(true);
    expect(matchesQuery(course, "ana")).toBe(true);
    expect(matchesQuery(course, "welder")).toBe(false);
    expect(matchesQuery(course, "")).toBe(true);
  });

  it("never matches on the hidden author id", () => {
    expect(matchesQuery(listing({ authorId: "needle" }), "needle")).toBe(false);
  });
});

describe("sortListings", () => {
  const old = listing({ mapId: "old", likeCount: 5, publishedAt: "2026-11-01T00:00:00.000Z" });
  const mid = listing({ mapId: "mid", likeCount: 5, publishedAt: "2026-11-03T00:00:00.000Z" });
  const fresh = listing({ mapId: "fresh", likeCount: 1, publishedAt: "2026-11-05T00:00:00.000Z" });

  it("popular: most likes first, then newest", () => {
    expect(sortListings([fresh, old, mid], "popular").map((l) => l.mapId)).toEqual(["mid", "old", "fresh"]);
  });

  it("new: newest first, whatever the likes", () => {
    expect(sortListings([old, fresh, mid], "new").map((l) => l.mapId)).toEqual(["fresh", "mid", "old"]);
  });

  it("does not change the list it was given", () => {
    const input = [old, fresh];
    sortListings(input, "new");
    expect(input.map((l) => l.mapId)).toEqual(["old", "fresh"]);
  });
});

describe("learningOrder", () => {
  it("puts every skill after the skills it needs, keeping map order among equals", () => {
    const nodes = [makeNode("c", ["b"]), makeNode("a"), makeNode("b", ["a"]), makeNode("d")];
    expect(learningOrder(nodes).map((n) => n.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("ignores a prerequisite that is not on the map, and never drops a skill", () => {
    const nodes = [makeNode("a", ["ghost"]), makeNode("x", ["y"]), makeNode("y", ["x"])];
    expect(learningOrder(nodes).map((n) => n.id)).toEqual(["a", "x", "y"]);
  });
});
