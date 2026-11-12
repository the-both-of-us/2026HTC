import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProofSnapshot } from "../types";
import { ProofDocument } from "./ProofDocument";

const base: ProofSnapshot = {
  version: 1,
  proofId: "p1",
  displayName: "Sam",
  roleTitle: "Introduction to Psychology",
  roleSubtitle: "",
  sourceKind: "topic",
  totalSkills: 3,
  skills: [],
  notYetProven: [],
  publishedAt: "2026-11-12T12:00:00.000Z",
};

const render = (snapshot: ProofSnapshot) => renderToStaticMarkup(<ProofDocument snapshot={snapshot} hash="abc" url="https://example.test/proof/p1" />);

describe("tests on the evidence page", () => {
  it("labels a multiple-choice final and unit tests as multiple choice, with their scores", () => {
    const html = render({
      ...base,
      finalInterview: { passedCount: 8, questionCount: 10, format: "multiple-choice", finishedAt: "2026-11-12T11:00:00.000Z" },
      unitTests: [{ title: "Unit 1: Memory", passedCount: 5, questionCount: 6, format: "multiple-choice", finishedAt: "2026-11-11T11:00:00.000Z" }],
    });
    expect(html).toContain("Final test: 8 of 10, multiple choice.");
    expect(html).toContain("Unit 1: Memory. Unit test: 5 of 6, multiple choice.");
    // No transcript, typing time or other signal is claimed for a test.
    expect(html).not.toMatch(/answered aloud|final interview|answered in writing|typing/i);
  });

  it("still shows a written final published before Nov 12 as written answers", () => {
    const html = render({ ...base, finalInterview: { passedCount: 2, finishedAt: "2026-11-01T11:00:00.000Z" } });
    expect(html).toContain("Passed the final interview");
    expect(html).toContain("answered in writing");
    expect(html).toContain("2 of 3 passed");
    expect(html).not.toContain("multiple choice");
  });
});
