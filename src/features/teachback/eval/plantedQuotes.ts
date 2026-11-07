import type { SkillNode } from "@/shared/types";
import { gradeExplanation } from "../grading";

/**
 * A live model rarely invents a quote, so a clean live run would not prove the check works.
 * This plants fake quotes in the reply, by swapping fetch for a stub, and sends them through
 * the real gradeExplanation. It costs nothing, and needs a key only so the route isn't skipped.
 */
const NODE: SkillNode = {
  id: "planted",
  title: "SQL joins",
  why: "",
  prerequisites: [],
  fromSource: true,
  citation: null,
  checkpoints: ["An INNER JOIN returns only rows that match in both tables."],
};

const LEARNER_TEXT = "Joins are useful, and I use them with customers and orders at work every single day.";

const PLANTED = [
  { name: "The checkpoint itself, which the learner never wrote", quote: NODE.checkpoints[0] },
  { name: "A paraphrase of the learner's words", quote: "I use joins at work with orders and customers" },
  { name: "Two real pieces joined by an ellipsis", quote: "Joins are useful ... every single day" },
  { name: "Real words with one word changed", quote: "I use them with clients and orders at work" },
  { name: "An empty string", quote: "" },
  { name: "Only whitespace", quote: "   " },
];

export type PlantedResult = { name: string; quote: string; rejected: boolean };

export async function runPlantedQuotes(): Promise<PlantedResult[]> {
  const realFetch = globalThis.fetch;
  const realKey = process.env.CEREBRAS_API_KEY;
  process.env.CEREBRAS_API_KEY = realKey || "planted-test";
  const results: PlantedResult[] = [];

  try {
    for (const { name, quote } of PLANTED) {
      const reply = JSON.stringify({ checkpoints: [{ number: 1, quote }], factualErrors: [] });
      globalThis.fetch = async () => Response.json({ choices: [{ message: { content: reply } }] });
      const grade = await gradeExplanation(NODE, LEARNER_TEXT);
      results.push({ name, quote, rejected: !grade.checkpoints[0].met && grade.score === 0 });
    }
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.CEREBRAS_API_KEY;
    else process.env.CEREBRAS_API_KEY = realKey;
  }
  return results;
}
