import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SkillNode } from "@/shared/types";
import type { QuizQuestion } from "./types";

/** A quiz error carries a sentence for people and the HTTP status to send with it. */
export class QuizError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "QuizError";
  }
}

export const QUESTIONS_WANTED = 5;
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 6;
export const OPTION_COUNT = 4;
export const MAX_PROMPT_LENGTH = 200;
export const MAX_OPTION_LENGTH = 120;
export const MAX_EXPLANATION_LENGTH = 400;

/** The shape we ask the model for. Lenient on purpose: validateQuiz does the real checks. */
export const rawQuizSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string(),
      /** The correct option comes first. Code shuffles them before saving. */
      options: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
});

export type RawQuiz = z.infer<typeof rawQuizSchema>;

/** Returns a number in [0, 1), like Math.random. */
export type RandomSource = () => number;

/** A small seeded generator (mulberry32), so tests get the same shuffle every run. */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Returns a new array and leaves the input alone. */
export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * True catch-all options only, matched against the whole option, so ordinary answers such as
 * "All of them" or "Rows from both of those tables" are kept.
 */
const CATCH_ALL_OPTIONS = [
  /^(all|none|both|neither)\s+of\s+the\s+above\b/i,
  /^(all|none|both|neither)\s+of\s+(these|the\s+(options|answers|choices))\.?$/i,
];

/** A label the model added despite being told not to, such as "A. " or "2) ". */
const OPTION_LABEL = /^[A-Da-d1-4][.)]\s+/;

/**
 * Words that point at an option by position. Code shuffles the options, so any such
 * reference would point at the wrong one. Letters must be capitals, so "the answer a user
 * gives" is not caught.
 */
const POSITION_REFERENCES = [
  /\b([Oo]ptions?|[Cc]hoices?|[Aa]nswers?)\s+\(?[A-D1-4]\)?(?!\w|\.\d)/,
  /\b(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+(option|one|choice|answer)s?\b/i,
];

export function isCatchAll(option: string): boolean {
  return CATCH_ALL_OPTIONS.some((pattern) => pattern.test(option));
}

export function mentionsPosition(text: string): boolean {
  return POSITION_REFERENCES.some((pattern) => pattern.test(text));
}

/** Lower case with single spaces, for spotting duplicates. */
function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function clean(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

type Candidate = { prompt: string; options: string[]; explanation: string };

/** Returns the cleaned question, or null if any part of it breaks a rule. */
function checkQuestion(raw: RawQuiz["questions"][number]): Candidate | null {
  const prompt = clean(raw.prompt);
  const explanation = clean(raw.explanation);
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) return null;
  if (!explanation || explanation.length > MAX_EXPLANATION_LENGTH) return null;
  // Options are shuffled before saving, so "the first option" would be wrong on screen.
  if (mentionsPosition(prompt) || mentionsPosition(explanation)) return null;

  // The correct option is first, so keeping the first four keeps it.
  if (raw.options.length < OPTION_COUNT) return null;
  const options = raw.options.slice(0, OPTION_COUNT).map((option) => clean(clean(option).replace(OPTION_LABEL, "")));
  if (options.some((option) => !option || option.length > MAX_OPTION_LENGTH)) return null;
  if (options.some(isCatchAll)) return null;
  if (new Set(options.map(normalize)).size !== OPTION_COUNT) return null;

  return { prompt, options, explanation };
}

export type QuizContext = { mapId: string; node: SkillNode };

/**
 * Turns the model's reply into saved questions. Code sets every id, the map and node,
 * the citation and the answer position: the model writes only the words.
 */
export function validateQuiz(
  raw: RawQuiz,
  { mapId, node }: QuizContext,
  random: RandomSource = Math.random,
): QuizQuestion[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const question of raw.questions) {
    const checked = checkQuestion(question);
    if (!checked) continue;
    const key = normalize(checked.prompt);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(checked);
    if (candidates.length === MAX_QUESTIONS) break;
  }

  if (candidates.length < MIN_QUESTIONS) {
    throw new QuizError("We could not write a good quiz for this skill this time. Please try again.", 502);
  }

  const citation = node.citation?.verified ? node.citation : null;

  return candidates.map(({ prompt, options, explanation }) => {
    // Shuffle positions, so the right answer is not always first.
    const order = shuffle(
      options.map((_, index) => index),
      random,
    );
    return {
      id: randomUUID(),
      mapId,
      nodeId: node.id,
      prompt,
      options: order.map((index) => options[index]),
      answerIndex: order.indexOf(0),
      explanation,
      citation,
    };
  });
}
