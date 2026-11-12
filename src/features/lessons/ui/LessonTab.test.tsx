import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Lesson, LessonPart } from "../types";
import { publicParts } from "./api";
import { draftOfLesson, draftOfParts } from "./draft";
import { LessonArticle, LessonSkeleton } from "./LessonTab";

const skill = { id: "n1", title: "Memory" };
const parts: LessonPart[] = [
  { part: "idea", text: "First idea." },
  { part: "idea", text: "Second idea." },
  { part: "example", intro: "Try this.", code: null, after: "See?" },
  { part: "mistake", mistake: "Wrong thing", fix: "Right thing" },
];

describe("progressive lesson", () => {
  it("draws the parts so far in order, with Writing under the last and no later sections", () => {
    const html = renderToStaticMarkup(<LessonArticle mapId="m" skill={skill} draft={draftOfParts(parts)} lesson={null} />);
    expect(html.indexOf("First idea.")).toBeLessThan(html.indexOf("Second idea."));
    expect(html.indexOf("The idea")).toBeLessThan(html.indexOf("An example"));
    expect(html.indexOf("An example")).toBeLessThan(html.indexOf("Common mistakes"));
    expect(html).not.toContain("Check yourself");
    expect(html).toContain("Writing…");
    expect(html).not.toContain("min read");
    expect(html).not.toContain("Prove");
  });

  it("says Improving when the parts are a rewrite", () => {
    expect(renderToStaticMarkup(<LessonArticle mapId="m" skill={skill} draft={draftOfParts(parts)} lesson={null} improving />)).toContain("Improving this lesson…");
    expect(renderToStaticMarkup(<LessonSkeleton improving />)).toContain("Improving this lesson…");
  });

  it("never puts a model answer in the page, even if the server sent one by mistake", () => {
    const sent = [...parts, { part: "practice", scenario: "A case", question: "What now?", modelAnswer: "SECRET-ANSWER-KEY" }];
    const cleaned = publicParts(sent);
    expect(JSON.stringify(cleaned)).not.toContain("SECRET-ANSWER-KEY");
    const html = renderToStaticMarkup(<LessonArticle mapId="m" skill={skill} draft={draftOfParts(cleaned)} lesson={null} />);
    expect(html).toContain("A case");
    expect(html).toContain("once the lesson is finished");
    expect(html).not.toContain("SECRET-ANSWER-KEY");
    expect(html).not.toContain("<textarea");
  });

  it("drops malformed parts and keeps a final lesson complete", () => {
    expect(publicParts([{ part: "idea" }, { part: "nope" }, null, { part: "idea", text: "ok" }])).toEqual([{ part: "idea", text: "ok" }]);
    const lesson: Lesson = {
      idea: ["i"], example: { intro: "x", code: null, after: "y" }, mistakes: [{ mistake: "m", fix: "f" }],
      checks: [{ question: "q1", answer: "a1" }, { question: "q2", answer: "a2" }],
      practice: [{ scenario: "s", question: "pq" }], readingMinutes: 3,
    };
    const html = renderToStaticMarkup(<LessonArticle mapId="m" skill={skill} draft={draftOfLesson(lesson)} lesson={lesson} onReady={() => {}} />);
    expect(html).toContain("3 min read");
    expect(html).toContain("<textarea");
    // A stuck learner can always ask for help, before typing anything.
    expect(html).toContain("Get a hint");
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Get a hint/);
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Check my answer/);
    expect(html).toContain("Prove Memory");
    expect(html).not.toContain("Writing…");
  });
});
