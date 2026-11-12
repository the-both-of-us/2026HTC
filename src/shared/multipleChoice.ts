/**
 * Multiple-choice questions shared by every test: the model writes the correct option first
 * plus a short explanation, code checks it, shuffles it once, stores the key on the server and
 * grades submissions. Plain module, no server-only imports.
 */
import { z } from "zod";

export const MC_OPTION_COUNT = 4;
export const MC_MAX_QUESTION_LENGTH = 200;
export const MC_MAX_OPTION_LENGTH = 120;
export const MC_MAX_EXPLANATION_LENGTH = 400;

// ---------- randomness ----------

/** Returns a number in [0, 1), like Math.random. */
export type RandomSource = () => number;

/** A small seeded generator (mulberry32), so a seed gives the same sequence every run. */
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

/** A 32-bit seed from text (FNV-1a), for seeding by learner and test id. */
export function seedFromText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
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

// ---------- the model's question ----------

/** The shape we ask the model for. Lenient on purpose: validation does the real checks. */
export const rawMcQuestionSchema = z.object({
  question: z.string(),
  /** The correct option comes first. Code shuffles them before saving. */
  options: z.array(z.string()),
  explanation: z.string(),
});

export type RawMcQuestion = z.infer<typeof rawMcQuestionSchema>;

/** Rules for writing options and explanations. Every generator puts this in its system prompt. */
export const MC_PROMPT_RULES = `OPTIONS
- Exactly ${MC_OPTION_COUNT} options. The FIRST option is the one correct answer. The other ${MC_OPTION_COUNT - 1} are wrong.
- Each option under ${MC_MAX_OPTION_LENGTH - 40} characters, with similar length and style, so the answer does not stand out.
- Wrong options are plausible mistakes a beginner really makes, but clearly wrong to someone who understands.
- Never use "all of the above", "none of the above" or "both of these". No two options may say the same thing.
- Do not number or letter the options.
- Only write a question whose answer every expert agrees with.

EXPLANATION
- Under ${MC_MAX_EXPLANATION_LENGTH - 100} characters: why the correct answer is right, and why the most tempting wrong option is wrong.
- Do not refer to options by position, such as "option A" or "the first one", since the order will change.`;

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

/** Trimmed, with single spaces. */
export function cleanText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** Lower case with single spaces, for spotting duplicates. */
export function normalizeText(text: string): string {
  return cleanText(text).toLowerCase();
}

/** A question with clean text and exactly four options, the correct one first. */
export type CleanMcQuestion = { question: string; options: string[]; explanation: string };

/** Cleans the text, strips option labels and keeps the first four options (the correct one is first). */
export function cleanMcQuestion(raw: RawMcQuestion): CleanMcQuestion {
  return {
    question: cleanText(raw.question),
    options: raw.options.slice(0, MC_OPTION_COUNT).map((option) => cleanText(cleanText(option).replace(OPTION_LABEL, ""))),
    explanation: cleanText(raw.explanation),
  };
}

/**
 * Why a raw question breaks a rule, as a sentence a model can act on, or null when it is fine.
 * Checks the cleaned form, so a stray "A. " label alone is not a problem.
 */
export function mcQuestionProblem(raw: RawMcQuestion): string | null {
  if (raw.options.length < MC_OPTION_COUNT) return `Write exactly ${MC_OPTION_COUNT} options.`;
  const { question, options, explanation } = cleanMcQuestion(raw);
  if (!question) return "The question is empty.";
  if (question.length > MC_MAX_QUESTION_LENGTH) return `Keep the question under ${MC_MAX_QUESTION_LENGTH} characters.`;
  if (!explanation) return "Add a one or two sentence explanation.";
  if (explanation.length > MC_MAX_EXPLANATION_LENGTH) return `Keep the explanation under ${MC_MAX_EXPLANATION_LENGTH} characters.`;
  if (mentionsPosition(question) || mentionsPosition(explanation)) {
    return "Do not refer to an option by position (such as option B or the first one), since the order is shuffled.";
  }
  if (options.some((option) => !option)) return "Every option needs text.";
  if (options.some((option) => option.length > MC_MAX_OPTION_LENGTH)) return `Keep each option under ${MC_MAX_OPTION_LENGTH} characters.`;
  if (options.some(isCatchAll)) return 'Do not use "all of the above", "none of the above" or similar options.';
  if (new Set(options.map(normalizeText)).size !== MC_OPTION_COUNT) return "The options must all say different things.";
  return null;
}

// ---------- stored, public and review shapes ----------

/** What the server keeps: options in the learner's fixed shuffled order, and the key. */
export type StoredMcQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

/** What a browser gets before submitting: no key, no explanation. */
export type PublicMcQuestion = { question: string; options: string[] };

/** What a learner sees after submitting. `chosen` is null for a skipped question. */
export type McReviewItem = {
  question: string;
  options: string[];
  chosen: number | null;
  correctIndex: number;
  explanation: string;
};

/** Shuffles a clean question (correct option first) into its stored form. Does not check it: use mcQuestionProblem first. */
export function toStoredQuestion(clean: CleanMcQuestion, random: RandomSource = Math.random): StoredMcQuestion {
  const order = shuffle(
    clean.options.map((_, index) => index),
    random,
  );
  return {
    question: clean.question,
    options: order.map((index) => clean.options[index]),
    correctIndex: order.indexOf(0),
    explanation: clean.explanation,
  };
}

/** Built field by field, so a key added to the stored shape later can never leak. */
export function toPublic(question: StoredMcQuestion): PublicMcQuestion {
  return { question: question.question, options: [...question.options] };
}

export type McGraded = McReviewItem & { isCorrect: boolean };
export type McGrade = { correctCount: number; total: number; results: McGraded[] };

/** A choice counts only if it is an integer index of an existing option. */
function validChoice(choice: unknown, optionCount: number): number | null {
  return typeof choice === "number" && Number.isInteger(choice) && choice >= 0 && choice < optionCount ? choice : null;
}

/** Grades in code. A missing or out-of-range choice is wrong; extra choices are ignored. */
export function gradeMc(questions: readonly StoredMcQuestion[], chosen: readonly (number | null | undefined)[]): McGrade {
  const results = questions.map((q, index): McGraded => {
    const pick = validChoice(chosen[index], q.options.length);
    return {
      question: q.question,
      options: [...q.options],
      chosen: pick,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      isCorrect: pick === q.correctIndex,
    };
  });
  return { correctCount: results.filter((r) => r.isCorrect).length, total: questions.length, results };
}

/** The after-submission review, built field by field from a grade. */
export function toReview(grade: McGrade): McReviewItem[] {
  return grade.results.map((r) => ({
    question: r.question,
    options: [...r.options],
    chosen: r.chosen,
    correctIndex: r.correctIndex,
    explanation: r.explanation,
  }));
}
