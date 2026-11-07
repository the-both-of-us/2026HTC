import { describe, expect, it } from "vitest";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { buildSkillMap } from "../build";
import { findCachedOutput } from "./index";

describe("demo cache", () => {
  it("does not match text that is not a sample", () => {
    expect(findCachedOutput(`${SAMPLE_POSTINGS[0].text} one more word`)).toBeNull();
  });

  // If someone edits a sample's text, this fails: run scripts/cache-samples.ts --force.
  describe.each(SAMPLE_POSTINGS)("$id", (sample) => {
    const raw = findCachedOutput(sample.text);

    it("has saved output, found even with outer whitespace", () => {
      expect(raw).not.toBeNull();
      expect(findCachedOutput(`  ${sample.text}\n`)).toEqual(raw);
    });

    it("passes every check, with every citation verified", () => {
      const map = buildSkillMap(raw!, sample.text, "posting", "test");
      expect(map.nodes.length).toBeGreaterThanOrEqual(10);
      expect(map.nodes.length).toBeLessThanOrEqual(14);
      for (const node of map.nodes) {
        expect(node.checkpoints.length).toBeGreaterThanOrEqual(3);
        expect(node.checkpoints.length).toBeLessThanOrEqual(4);
        expect(node.citation?.verified ?? true).toBe(true);
        expect(node.fromSource).toBe(node.citation !== null);
      }
    });
  });
});
