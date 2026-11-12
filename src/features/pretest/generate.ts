import { chatJSON } from "@/features/ai";
import { readOnce, startOnce } from "@/shared/store/once";
import type { SyllabusUnit } from "@/shared/types";
import { buildQuestionsPrompt, orderQuestions, questionsReplySchema, QUESTIONS_SYSTEM, type CourseContext } from "./prompt";
import { discardOldSet, isMultipleChoiceSet, setKey } from "./storage";
import type { PretestQuestionSet } from "./types";

/** One unit's questions: the write profile, 6k tokens and 40 s for the whole call, repair included. */
export const QUESTIONS_MAX_TOKENS = 6_000;
export const QUESTIONS_TOTAL_MS = 40_000;

export type SetInput = {
  courseId: string;
  /** The canonical syllabus unit (all its planned topics), never one learner's cut-down copy. */
  unit: SyllabusUnit;
  /** 1-based. */
  unitNumber: number;
  course: CourseContext;
  /** Work must end by this time (ms). */
  deadline: number;
};

/** "ready", "running" (someone is writing it), "idle" (nobody is: it failed or never started). */
export type SetState = { state: "ready"; set: PretestQuestionSet } | { state: "running" } | { state: "idle" };

/** Reads a unit's question set without writing anything. */
export async function readQuestionSet(courseId: string, unitId: string): Promise<SetState> {
  const read = await readOnce<PretestQuestionSet>(setKey(courseId, unitId));
  // A set written before multiple choice reads as missing, so the learner is not stuck on it.
  if (read.state === "ready") return isMultipleChoiceSet(read.value) ? { state: "ready", set: read.value } : { state: "idle" };
  return { state: read.state };
}

/**
 * Writes a unit's multiple-choice questions once for every learner of the course, under
 * `startOnce("pretest-sets/<courseId>/<unitId>")`: one model call (plus chatJSON's one repair).
 * Zero calls when the set exists or someone else is writing it, and none when the deadline
 * cannot fit the call. Resolves when this call's own work is done; never throws.
 */
export async function ensureQuestionSet(input: SetInput): Promise<SetState> {
  const key = setKey(input.courseId, input.unit.id);
  if (input.deadline - Date.now() < QUESTIONS_TOTAL_MS) return readQuestionSet(input.courseId, input.unit.id);
  const topicIds = input.unit.topics.map((topic) => topic.id);
  // A short-answer set from before multiple choice is dropped here (the write is certain to be tried).
  await discardOldSet(input.courseId, input.unit.id).catch(() => undefined);
  const started = await startOnce<PretestQuestionSet>(key, async () => {
    const reply = await chatJSON({
      profile: "write",
      label: "pretest-questions",
      system: QUESTIONS_SYSTEM,
      prompt: buildQuestionsPrompt(input.course, input.unit, input.unitNumber, input.unit.topics),
      schema: questionsReplySchema(topicIds),
      maxTokens: QUESTIONS_MAX_TOKENS,
      totalMs: QUESTIONS_TOTAL_MS,
    });
    return {
      courseId: input.courseId,
      unitId: input.unit.id,
      questions: orderQuestions(reply, topicIds),
      createdAt: new Date().toISOString(),
    };
  });
  if (started === "ready") return readQuestionSet(input.courseId, input.unit.id);
  if (started === "running") return { state: "running" };
  try {
    return { state: "ready", set: await started.work };
  } catch (error) {
    console.warn(`[pretest] questions for ${input.unit.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { state: "idle" };
  }
}
