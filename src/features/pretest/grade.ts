import { gradeMc, toReview } from "@/shared/multipleChoice";
import type { PresentedQuestion } from "./layout";
import type { PretestGradedUnit } from "./types";

/** What the learner picked for one question: an option index, or null for "I don't know this". */
export type GivenChoice = number | null;

/**
 * Grades one unit in code, with no model call. A question with no choice, or "I don't know this"
 * (null), is "skipped" and never passes; the right option is "known"; any other is "missed".
 * Each result carries the review (the choice, the correct option, the explanation), which is shown
 * only now that the unit is submitted.
 */
export function gradeUnit(questions: readonly PresentedQuestion[], choices: ReadonlyMap<string, GivenChoice>): PretestGradedUnit["results"] {
  const grade = gradeMc(
    questions,
    questions.map((question) => choices.get(question.topicId) ?? null),
  );
  const reviews = toReview(grade);
  return questions.map((question, index) => {
    const { chosen, isCorrect } = grade.results[index];
    return {
      topicId: question.topicId,
      outcome: chosen === null ? "skipped" : isCorrect ? "known" : "missed",
      review: reviews[index],
    };
  });
}
