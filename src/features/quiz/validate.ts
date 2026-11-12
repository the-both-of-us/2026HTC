import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SkillNode } from "@/shared/types";
import type { QuizQuestion } from "./types";
import { HttpError } from "@/shared/http";
import {
  cleanMcQuestion,
  isCatchAll,
  mcQuestionProblem,
  mentionsPosition,
  normalizeText,
  seededRandom,
  shuffle,
  MC_MAX_EXPLANATION_LENGTH,
  MC_MAX_OPTION_LENGTH,
  MC_MAX_QUESTION_LENGTH,
  MC_OPTION_COUNT,
  type RandomSource,
} from "@/shared/multipleChoice";

/** A quiz error carries a sentence for people and the HTTP status to send with it. */
export class QuizError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "QuizError";
  }
}

export const QUESTIONS_WANTED = 5;
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 6;
export const OPTION_COUNT = MC_OPTION_COUNT;
export const MAX_PROMPT_LENGTH = MC_MAX_QUESTION_LENGTH;
export const MAX_OPTION_LENGTH = MC_MAX_OPTION_LENGTH;
export const MAX_EXPLANATION_LENGTH = MC_MAX_EXPLANATION_LENGTH;

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

export { isCatchAll, mentionsPosition, seededRandom, shuffle, type RandomSource };

type Candidate = { prompt: string; options: string[]; explanation: string };

/** Returns the cleaned question, or null if any part of it breaks a rule. */
function checkQuestion(raw: RawQuiz["questions"][number]): Candidate | null {
  const mc = { question: raw.prompt, options: raw.options, explanation: raw.explanation };
  if (mcQuestionProblem(mc) !== null) return null;
  const { question, options, explanation } = cleanMcQuestion(mc);
  return { prompt: question, options, explanation };
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
    const key = normalizeText(checked.prompt);
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
