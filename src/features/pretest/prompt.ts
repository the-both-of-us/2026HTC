import { z } from "zod";
import { cleanMcQuestion, mcQuestionProblem, MC_PROMPT_RULES, rawMcQuestionSchema } from "@/shared/multipleChoice";
import type { SyllabusTopic, SyllabusUnit } from "@/shared/types";
import type { PretestQuestion } from "./types";

/*
 * The one prompt: writing a unit's multiple-choice questions (write profile). Nothing a learner
 * types ever reaches a model: answers are chosen options, graded in code.
 */

export const QUESTIONS_SYSTEM = `You write a short multiple-choice placement pre-test for one unit of a course. It tells which topics a learner already knows, so they can skip them.

Write exactly one question per topic listed, using the topic's id.
- Test understanding of the topic's objectives and key terms, not trivia, dates or names.
- One clear question, at most 35 words. No yes/no or true/false questions, no "which of these is NOT".
- The question must not contain or hint at its answer, and must not mention its options.
- Stay inside the topic's scope.

${MC_PROMPT_RULES}

Reply as JSON: {"questions": [{"topicId": "...", "question": "...", "options": ["correct", "wrong", "wrong", "wrong"], "explanation": "..."}]}`;

export type CourseContext = { title: string; audience: string };

/** The question-writing prompt for one unit. Built from the syllabus only: no learner data. */
export function buildQuestionsPrompt(course: CourseContext, unit: Pick<SyllabusUnit, "title">, unitNumber: number, topics: SyllabusTopic[]): string {
  const lines = topics.map((topic) =>
    [
      `- id: ${topic.id}`,
      `  title: ${topic.title}`,
      `  objectives: ${topic.objectives.join("; ")}`,
      `  key terms: ${topic.keyTerms.join(", ")}`,
      `  covers: ${topic.inScope}`,
      `  leaves out: ${topic.outOfScope}`,
    ].join("\n"),
  );
  return [
    `Course: ${course.title}`,
    ...(course.audience ? [`Learners: ${course.audience}. Ask in words they know.`] : []),
    `Unit ${unitNumber}: ${unit.title}`,
    "",
    "Topics:",
    ...lines,
  ].join("\n");
}

const questionSchema = rawMcQuestionSchema.extend({ topicId: z.string() });

/** The reply for one unit: exactly one valid question per topic id, in any order. */
export function questionsReplySchema(topicIds: string[]) {
  return z
    .object({ questions: z.array(questionSchema) })
    .superRefine((reply, context) => {
      const seen = new Set<string>();
      for (const item of reply.questions) {
        if (!topicIds.includes(item.topicId)) {
          context.addIssue({ code: "custom", message: `"${item.topicId}" is not one of the topic ids.` });
          continue;
        }
        if (seen.has(item.topicId)) context.addIssue({ code: "custom", message: `Topic "${item.topicId}" has more than one question.` });
        seen.add(item.topicId);
        const problem = mcQuestionProblem(item);
        if (problem) context.addIssue({ code: "custom", message: `Topic "${item.topicId}": ${problem}` });
      }
      const missing = topicIds.filter((id) => !seen.has(id));
      if (missing.length > 0) context.addIssue({ code: "custom", message: `Missing a question for: ${missing.join(", ")}.` });
    });
}

/** The reply in syllabus topic order, cleaned, the correct option still first. */
export function orderQuestions(reply: { questions: (z.infer<typeof questionSchema>)[] }, topicIds: string[]): PretestQuestion[] {
  return topicIds.flatMap((id) => {
    const item = reply.questions.find((question) => question.topicId === id);
    return item ? [{ topicId: id, ...cleanMcQuestion(item) }] : [];
  });
}
