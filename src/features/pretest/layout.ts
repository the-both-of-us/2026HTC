import { seededRandom, seedFromText, toStoredQuestion, type StoredMcQuestion } from "@/shared/multipleChoice";
import type { PretestQuestionSet, PretestRecord } from "./types";

/*
 * Each learner's own option order. The canonical set holds every question with the correct option
 * first; the learner's record holds a seed (server only), and the order of every question is
 * derived from that seed, the unit and the topic. So a reload shows the same order, two learners
 * of one course get different orders, and a reply never says which option was first.
 */

/** A question in this learner's order, with its key. Server only: never send it as is. */
export type PresentedQuestion = StoredMcQuestion & { topicId: string };

/** The seed to store on a new record. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

/** The record's seed; a record from before multiple choice has none, so one is derived from its ids. */
export function seedOf(record: Pick<PretestRecord, "seed" | "courseId" | "ownerId">): number {
  return typeof record.seed === "number" ? record.seed : seedFromText(`${record.courseId}/${record.ownerId}`);
}

/** Every question of the unit's set, in the learner's fixed order. */
export function presentSet(set: PretestQuestionSet, seed: number): PresentedQuestion[] {
  return set.questions.map((question) => ({
    topicId: question.topicId,
    ...toStoredQuestion(
      { question: question.question, options: question.options, explanation: question.explanation },
      seededRandom(seedFromText(`${seed}/${set.unitId}/${question.topicId}`)),
    ),
  }));
}
