import { describe, expect, it } from "vitest";
import { assignFormats, FORMAT_ROTATION, readingGrade } from "./formats";

type Topic = { id: string; prerequisites: string[] };

/** A chain a -> b -> c ..., each built on the one before. */
function chain(count: number): Topic[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    prerequisites: index === 0 ? [] : [`t${index - 1}`],
  }));
}

describe("assignFormats", () => {
  it("gives the same answer every time", () => {
    const topics = chain(9);
    expect(assignFormats(topics)).toEqual(assignFormats(topics));
  });

  it("uses all four formats on a long enough map, starting with Catch the mistake", () => {
    const formats = assignFormats(chain(8));
    expect(formats.t0).toBe("catch");
    expect(new Set(Object.values(formats))).toEqual(new Set(FORMAT_ROTATION));
  });

  it("never gives a topic the same format as the topic before it or one it builds on", () => {
    // A wider map: two roots, a topic joining them, and a fan-out.
    const topics: Topic[] = [
      { id: "a", prerequisites: [] },
      { id: "b", prerequisites: [] },
      { id: "c", prerequisites: ["a", "b"] },
      { id: "d", prerequisites: ["c"] },
      { id: "e", prerequisites: ["c"] },
      { id: "f", prerequisites: ["a", "d", "e"] },
      { id: "g", prerequisites: ["f"] },
    ];
    const formats = assignFormats(topics);
    topics.forEach((topic, index) => {
      const neighbours = [...topic.prerequisites, topics[index - 1]?.id].filter(Boolean) as string[];
      for (const id of neighbours) expect(formats[topic.id]).not.toBe(formats[id]);
    });
  });

  it("mixes a row of siblings that build on the same topic", () => {
    const topics: Topic[] = [
      { id: "root", prerequisites: [] },
      ...["a", "b", "c"].map((id) => ({ id, prerequisites: ["root"] })),
    ];
    const formats = assignFormats(topics);
    expect(new Set(Object.values(formats)).size).toBe(4);
  });

  it("does not depend on anything but the topics' ids and order", () => {
    const first = assignFormats(chain(5));
    const renamed = assignFormats(chain(5).map((topic) => ({ ...topic })));
    expect(renamed).toEqual(first);
  });
});

describe("readingGrade", () => {
  it("scores short everyday sentences low", () => {
    expect(readingGrade("A cell is a tiny room. It has walls. Food goes in. Waste comes out.")).toBeLessThanOrEqual(8);
  });

  it("scores long technical sentences high", () => {
    const text =
      "Photosynthetic organisms utilize chlorophyll-containing chloroplasts to transform electromagnetic radiation into chemical potential energy, subsequently synthesizing carbohydrates through enzymatically catalyzed biochemical reactions.";
    expect(readingGrade(text)).toBeGreaterThan(8);
  });

  it("is zero for no words", () => {
    expect(readingGrade("")).toBe(0);
  });
});
