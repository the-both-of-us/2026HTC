import { z } from "zod";
import { chatJSON } from "@/features/ai";
import { normalizeForMatch, quoteAppearsIn } from "@/shared/quote";
import type { CheckpointResult, Grade, SkillNode } from "@/shared/types";
import { countWords, LEARNER_TEXT_RULE, wrapLearnerText } from "./learnerText";

const GRADER_SYSTEM = `You check a learner's explanation of a skill against a fixed list of checkpoints. You do not give a score.

For each checkpoint, return the number of the checkpoint and either a quote or null.
- A quote is words copied exactly from the learner's text, in one unbroken piece, with no edits and no ellipsis. Use the shortest passage of at least three words that states the fact on its own.
- Return null unless the learner states the specific fact in the checkpoint. If a reader could not check that fact from the quote alone, return null.
- Fluent general wording does not count. Polished phrases that only sound related to the topic, such as "a robust approach", "delivers comprehensive coverage" or "focuses on what matters", state no checkable fact, so they get null. Never give credit for what the learner probably meant.
- Plain, informal or clumsy wording does count, when the specific fact is really there. Different words for the same idea count: "a false positive" states the same fact as "wrongly rejecting the null hypothesis".
- Look for the main fact only. A side detail in the checkpoint, such as an example after "like" or "such as" or a number after "typically", is not required.

Also list factualErrors: statements in the learner's text that are clearly false, one short sentence each, saying what they claimed and what is true. Something missing is not an error. Vague or informal wording is not an error. Return an empty list if nothing is false.

${LEARNER_TEXT_RULE}`;

const graderReplySchema = z.object({
  checkpoints: z.array(z.object({ number: z.number().int(), quote: z.string().nullable() })),
  factualErrors: z.array(z.string()),
});

/** A quote this short can't show a fact, and almost any text contains it. */
const MIN_QUOTE_WORDS = 3;
/** A checkpoint shorter than this is a natural sentence, so saying it isn't evidence of copying. */
const MIN_WORDS_TO_CHECK_FOR_COPYING = 7;
const NOT_AN_ERROR = /^(none|nothing|n\/?a|no (factual )?errors?)\.?$/;

/** Asks the model for quotes and errors. The code below decides what they are worth. */
export async function gradeExplanation(node: SkillNode, explanation: string): Promise<Grade> {
  const reply = await chatJSON({
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

    if (!isUsableQuote(quote, explanation) || copiesCheckpoint(checkpoint, explanation)) {
      rejectedQuotes += 1;
      return { checkpoint, quote: null, met: false };
    }
    return { checkpoint, quote, met: true };
  });

  const misconceptions = cleanErrors(reply.factualErrors);
  const met = checkpoints.filter((result) => result.met).length;

  return {
    score: computeScore(met, checkpoints.length, misconceptions.length),
    checkpoints,
    misconceptions,
    rejectedQuotes,
  };
}

function isUsableQuote(quote: string, explanation: string): boolean {
  return countWords(quote) >= MIN_QUOTE_WORDS && quoteAppearsIn(quote, explanation);
}

/**
 * True if the learner's text holds a checkpoint's own words, nearly unchanged. A failed
 * attempt shows the missed checkpoints, so retyping that list must not earn them back.
 * It slides a checkpoint-sized window over the text, and allows one word in six to differ.
 */
export function copiesCheckpoint(checkpoint: string, explanation: string): boolean {
  const wanted = wordsOf(checkpoint);
  if (wanted.length < MIN_WORDS_TO_CHECK_FOR_COPYING) return false;

  const written = wordsOf(explanation);
  const needed = wanted.length - Math.floor(wanted.length / 6);
  for (let start = 0; start + wanted.length <= written.length; start += 1) {
    const window = new Set(written.slice(start, start + wanted.length));
    if (wanted.filter((word) => window.has(word)).length >= needed) return true;
  }
  return false;
}

function wordsOf(text: string): string[] {
  return normalizeForMatch(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Each error costs 20 points, so a repeat or a "None" must not count as one. */
function cleanErrors(errors: string[]): string[] {
  const seen = new Set<string>();
  return errors
    .map((error) => error.trim())
    .filter((error) => {
      const key = normalizeForMatch(error);
      if (!key || NOT_AN_ERROR.test(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** The scoring formula from SPEC.md. The model never sees or sets this number. */
export function computeScore(met: number, total: number, errors: number): number {
  if (total === 0) return 0;
  return Math.max(0, Math.round((met / total) * 100) - 20 * errors);
}

export function numberedList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}
