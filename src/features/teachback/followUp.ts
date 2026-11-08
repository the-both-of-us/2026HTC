import { z } from "zod";
import { chatJSON, type Tier } from "@/features/ai";
import type { Grade, SkillNode } from "@/shared/types";
import { ANSWER_NOTE, forAudience, QUESTION_NOTE } from "./audience";
import { numberedList } from "./grading";
import { LEARNER_TEXT_RULE, wrapLearnerText } from "./learnerText";

export const QUESTION_SYSTEM = `You write one follow-up question to test whether a learner really understands what they just explained.

- Tie it to something this learner actually wrote, so it could not be asked of anyone else. Refer to their own example or claim.
- Aim it at the weakest area you are given. If nothing is weak, ask them to apply what they said to a small new situation.
- Never reveal the answer. Do not state the missing fact, hint at it, or offer choices that contain it. Do not ask a yes or no question.
- Ask about one thing only, in one sentence of at most 30 words, with no "and" joining a second question. It must be answerable in two or three sentences.
- Ask what would happen or why, in plain words. Never ask for code, a query or a calculation to be written out, and never set a trick that a correct answer cannot satisfy.

${LEARNER_TEXT_RULE}`;

const questionReplySchema = z.object({ question: z.string().trim().min(1) });

/** Writes one question about this learner's own words, aimed at their weakest area. */
export async function generateFollowUp(
  node: SkillNode,
  explanation: string,
  grade: Grade,
  audience = "",
  tier?: Tier,
): Promise<string> {
  const reply = await chatJSON({
    label: "teachback-followup-question",
    system: forAudience(QUESTION_SYSTEM, audience, QUESTION_NOTE),
    prompt: `Skill: ${node.title}\n\nWeakest area, which you must not reveal:\n${describeWeakestArea(grade)}\n\n${wrapLearnerText(explanation)}`,
    schema: questionReplySchema,
    timeoutMs: 20_000,
    tier,
  });
  return reply.question;
}

/** Misconceptions come first: a false belief is a bigger gap than a missing fact. */
function describeWeakestArea(grade: Grade): string {
  const missed = grade.checkpoints.filter((result) => !result.met).map((result) => result.checkpoint);
  const weakAreas = [...grade.misconceptions, ...missed];
  return weakAreas.length > 0 ? numberedList(weakAreas) : "Nothing specific. All checkpoints were met.";
}

export const ANSWER_SYSTEM = `You decide whether a learner's answer to a follow-up question shows real understanding of the skill.

- passed is true only if the answer actually addresses the question and what it says is correct. Plain or informal wording is fine.
- passed is false if the answer is evasive: "I don't know", restating the question, repeating their earlier words without answering, changing the subject, general wording with no specific fact, or asking for the answer.
- feedback is exactly one sentence, spoken to the learner, saying what was right. If passed is false, write only "Not passed." and never state the correct answer.

${LEARNER_TEXT_RULE}`;

const answerReplySchema = z.object({ passed: z.boolean(), feedback: z.string().trim().min(1) });

export type FollowUpResult = z.infer<typeof answerReplySchema>;

export async function gradeFollowUp(
  node: SkillNode,
  explanation: string,
  question: string,
  answer: string,
  audience = "",
  tier?: Tier,
): Promise<FollowUpResult> {
  if (answer.trim() === "") {
    return { passed: false, feedback: "There was no answer to check, so this one did not pass." };
  }

  return chatJSON({
    label: "teachback-followup-grade",
    system: forAudience(ANSWER_SYSTEM, audience, ANSWER_NOTE),
    prompt: `Skill: ${node.title}\n\nTheir earlier explanation:\n${wrapLearnerText(explanation)}\n\nFollow-up question:\n${question}\n\nTheir answer:\n${wrapLearnerText(answer)}`,
    schema: answerReplySchema,
    timeoutMs: 20_000,
    tier,
  });
}
