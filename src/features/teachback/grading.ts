import { z } from "zod";
import type { CheckpointResult, Grade, SkillNode } from "@/shared/types";
import { askModel } from "./askModel";
import { LEARNER_TEXT_RULE, wrapLearnerText } from "./learnerText";

const GRADER_SYSTEM = `You check a learner's explanation of a skill against a fixed list of checkpoints. You do not give a score.

For each checkpoint, return the number of the checkpoint and either a quote or null.
- A quote is words copied exactly from the learner's text, in one unbroken piece, with no edits and no ellipsis. Use the shortest passage of at least three words that states the fact on its own.
- Return null unless the learner states the specific fact in the checkpoint. If a reader could not check that fact from the quote alone, return null.
- Fluent general wording does not count. Polished phrases that only sound related to the topic, such as "a robust approach", "delivers comprehensive coverage" or "focuses on what matters", state no checkable fact, so they get null. Never give credit for what the learner probably meant.
- Plain, informal or clumsy wording does count, when the specific fact is really there.

Also list factualErrors: statements in the learner's text that are clearly false, one short sentence each, saying what they claimed and what is true. Something missing is not an error. Vague or informal wording is not an error. Return an empty list if nothing is false.

${LEARNER_TEXT_RULE}`;

const graderReplySchema = z.object({
  checkpoints: z.array(z.object({ number: z.number().int(), quote: z.string().nullable() })),
  factualErrors: z.array(z.string()),
});

/** Asks the model for quotes and errors. The code below decides what they are worth. */
export async function gradeExplanation(node: SkillNode, explanation: string): Promise<Grade> {
  const reply = await askModel({
    label: "teachback-grade",
    system: GRADER_SYSTEM,
    prompt: `Skill: ${node.title}\n\nCheckpoints:\n${numberedList(node.checkpoints)}\n\n${wrapLearnerText(explanation)}`,
    schema: graderReplySchema,
    timeoutMs: 25_000,
  });

  let rejectedQuotes = 0;
  const checkpoints: CheckpointResult[] = node.checkpoints.map((checkpoint, index) => {
    const quote = reply.checkpoints.find((item) => item.number === index + 1)?.quote ?? null;
    if (quote === null) return { checkpoint, quote: null, met: false };

    if (!quoteIsInText(quote, explanation)) {
      rejectedQuotes += 1;
      return { checkpoint, quote: null, met: false };
    }
    return { checkpoint, quote, met: true };
  });

  const misconceptions = reply.factualErrors.map((error) => error.trim()).filter(Boolean);
  const met = checkpoints.filter((result) => result.met).length;

  return {
    score: computeScore(met, checkpoints.length, misconceptions.length),
    checkpoints,
    misconceptions,
    rejectedQuotes,
  };
}

/** The scoring formula from SPEC.md. The model never sees or sets this number. */
export function computeScore(met: number, total: number, errors: number): number {
  if (total === 0) return 0;
  return Math.max(0, Math.round((met / total) * 100) - 20 * errors);
}

/** Shorter than this, a quote can't state a checkable fact. */
export const MIN_QUOTE_WORDS = 3;

// Splits text the way a language's own rules do, so this also works for French and Arabic.
const wordSplitter = new Intl.Segmenter("und", { granularity: "word" });

/**
 * True only if the quote really appears in the text, ignoring case and whitespace. It must
 * be at least three words long and start and end on word edges, so "a" can't match inside
 * "data" and count as evidence.
 */
export function quoteIsInText(quote: string, text: string): boolean {
  const normalisedQuote = normalise(quote);
  const quoteWords = [...wordSplitter.segment(normalisedQuote)].filter((piece) => piece.isWordLike);
  if (quoteWords.length < MIN_QUOTE_WORDS) return false;

  const normalisedText = normalise(text);
  const wordEdges = new Set(
    [...wordSplitter.segment(normalisedText)].flatMap((piece) => [piece.index, piece.index + piece.segment.length]),
  );
  let at = normalisedText.indexOf(normalisedQuote);
  while (at !== -1) {
    if (wordEdges.has(at) && wordEdges.has(at + normalisedQuote.length)) return true;
    at = normalisedText.indexOf(normalisedQuote, at + 1);
  }
  return false;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}
