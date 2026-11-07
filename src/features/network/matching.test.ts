import { describe, expect, it } from "vitest";
import {
  dedupeProven,
  groupMatches,
  matchProfile,
  normalizeTitle,
  skillsMatch,
  titleTokens,
  toSkillSet,
} from "./matching";
import type { ProvenSkill, PublicProfile, SkillSet } from "./types";

const proven = (title: string, evidenceUrl: string | null = null): ProvenSkill => ({
  title,
  mapTitle: "Map",
  evidenceUrl,
});

const set = (provenTitles: string[], learning: string[]): SkillSet => ({
  proven: provenTitles.map((title) => proven(title)),
  learning,
  hasMaps: true,
});

function profile(name: string, isDemo = false): PublicProfile {
  return { publicId: name, displayName: name, city: "", lookingFor: "", contactUrl: null, isDemo, provenSkills: [], joinedAt: "2026-11-07T00:00:00Z" };
}

describe("title matching", () => {
  it("normalises case, punctuation and spaces", () => {
    expect(normalizeTitle("  Time‑series  DATA, cleaning! ")).toBe("time series data cleaning");
    expect(normalizeTitle("C++")).not.toBe(normalizeTitle("C#"));
    expect(skillsMatch("SQL Joins", "sql   joins.")).toBe(true);
  });

  it("matches close wordings by word overlap of 0.6 or more", () => {
    expect(skillsMatch("SQL joins", "SQL joins and unions")).toBe(true);
    expect(skillsMatch("SQL queries", "SQL query writing")).toBe(true);
    expect(skillsMatch("Python basics", "Python")).toBe(false);
    expect(skillsMatch("SQL joins", "Python basics")).toBe(false);
    expect(skillsMatch("", "")).toBe(false);
    expect(skillsMatch("C++", "C#")).toBe(false);
  });

  it("drops filler words and plural endings", () => {
    expect([...titleTokens("The basics of SQL queries")].sort()).toEqual(["basic", "query", "sql"]);
  });

  it("dedupes proven skills ignoring case, keeping one with an evidence page", () => {
    const result = dedupeProven([proven("SQL joins"), proven("sql JOINS", "/proof/abc"), proven("Python")]);
    expect(result).toEqual([proven("sql JOINS", "/proof/abc"), proven("Python")]);
  });

  it("leaves skills already proved, in any close wording, out of learning", () => {
    const skills = toSkillSet([proven("SQL queries")], ["SQL query writing", "Power BI", "power bi"], true);
    expect(skills.learning).toEqual(["Power BI"]);
  });
});

describe("matching", () => {
  const viewer = set(["Python basics"], ["SQL joins", "Power BI dashboards", "Load forecasting"]);

  it("scores 3 per skill they can teach, 2 per shared learning and 1 per shared proof", () => {
    const other = set(["SQL joins and unions", "Python basics"], ["Power BI dashboards", "Load forecasting"]);
    const match = matchProfile(viewer, other, profile("Priya"));
    expect(match.mentorFor).toEqual(["SQL joins and unions"]);
    expect(match.sharedLearning).toEqual(["Power BI dashboards", "Load forecasting"]);
    expect(match.sharedProven).toEqual(["Python basics"]);
    expect(match.score).toBe(3 * 1 + 2 * 2 + 1);
    expect(match.reasons).toEqual([
      "Proved SQL joins and unions, which you're learning.",
      "Also learning Power BI dashboards and Load forecasting.",
      "Also proved Python basics, like you.",
    ]);
  });

  it("shortens long lists in reasons", () => {
    const many = set(["A one", "B two", "C three", "D four", "E five"], []);
    const learner = set([], ["A one", "B two", "C three", "D four", "E five"]);
    expect(matchProfile(learner, many, profile("X")).reasons).toEqual([
      "Proved A one, B two, C three and 2 more, which you're learning.",
    ]);
  });

  it("puts each person in one section, best score first, real people before demos on a tie", () => {
    const mentorA = matchProfile(viewer, set(["SQL joins"], []), profile("Ana"));
    const mentorDemo = matchProfile(viewer, set(["SQL joins"], []), profile("Demo", true));
    const mentorB = matchProfile(viewer, set(["SQL joins", "Load forecasting"], []), profile("Bo"));
    const peer = matchProfile(viewer, set([], ["Power BI dashboards"]), profile("Cy"));
    const none = matchProfile(viewer, set(["Welding"], ["Carpentry"]), profile("Di"));
    const { mentors, peers, rest } = groupMatches([none, peer, mentorDemo, mentorA, mentorB]);
    expect(mentors.map((m) => m.profile.displayName)).toEqual(["Bo", "Ana", "Demo"]);
    expect(peers.map((m) => m.profile.displayName)).toEqual(["Cy"]);
    expect(rest.map((m) => m.profile.displayName)).toEqual(["Di"]);
  });
});
