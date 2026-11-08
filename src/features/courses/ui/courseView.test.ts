import { describe, expect, it } from "vitest";
import type { PublicCourse } from "../types";
import {
  countLabel,
  courseHref,
  hasSample,
  likesLabel,
  mapHref,
  provenCount,
  skillHref,
  optimisticLike,
  resultsSummary,
  skillsLabel,
} from "./courseView";

const COURSE: PublicCourse = {
  mapId: "m1",
  title: "T",
  subtitle: "",
  authorName: "Ana",
  skillCount: 3,
  likeCount: 0,
  isSample: false,
  publishedAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
};

describe("labels", () => {
  it("uses the singular only for one", () => {
    expect(countLabel(1, "course", "courses")).toBe("1 course");
    expect(countLabel(0, "course", "courses")).toBe("0 courses");
    expect(skillsLabel(12)).toBe("12 skills");
    expect(likesLabel(1)).toBe("1 like");
  });
});

describe("resultsSummary", () => {
  it("says how many courses, and what they match", () => {
    expect(resultsSummary(3, "")).toBe("3 courses.");
    expect(resultsSummary(1, " sql ")).toBe('1 course match "sql".');
  });

  it("has an empty message for no courses and for no match", () => {
    expect(resultsSummary(0, "")).toBe("No courses have been shared yet.");
    expect(resultsSummary(0, "welding")).toBe('No courses match "welding".');
  });
});

describe("hasSample", () => {
  it("is true only when a sample is shown", () => {
    expect(hasSample([COURSE])).toBe(false);
    expect(hasSample([COURSE, { ...COURSE, isSample: true }])).toBe(true);
    expect(hasSample([])).toBe(false);
  });
});

describe("optimisticLike", () => {
  it("adds or removes one like straight away", () => {
    expect(optimisticLike({ liked: false, likeCount: 2 }, true)).toEqual({ liked: true, likeCount: 3 });
    expect(optimisticLike({ liked: true, likeCount: 3 }, false)).toEqual({ liked: false, likeCount: 2 });
  });

  it("changes nothing when the state already matches, and never goes below zero", () => {
    const state = { liked: true, likeCount: 4 };
    expect(optimisticLike(state, true)).toBe(state);
    expect(optimisticLike({ liked: true, likeCount: 0 }, false)).toEqual({ liked: false, likeCount: 0 });
  });
});

describe("links", () => {
  it("encodes the id", () => {
    expect(courseHref("a b")).toBe("/courses/a%20b");
    expect(mapHref("m1")).toBe("/map/m1");
  });
});

describe("skillHref", () => {
  it("opens one skill in a map, encoding both ids", () => {
    expect(skillHref("m1", "n1")).toBe("/map/m1?skill=n1");
    expect(skillHref("a/b", "x y&z")).toBe("/map/a%2Fb?skill=x+y%26z");
  });
});

describe("provenCount", () => {
  it("counts only proven skills from the course, ignoring unknown ids", () => {
    expect(provenCount({ a: "proven", b: "available", c: "proven", z: "proven" }, ["a", "b", "c", "d"])).toBe(2);
    expect(provenCount({}, ["a"])).toBe(0);
  });
});
