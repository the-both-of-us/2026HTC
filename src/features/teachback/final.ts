import { randomUUID } from "node:crypto";
import { z } from "zod";
import { chatJSON } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { Attempt, SkillMap } from "@/shared/types";
import { ANSWER_NOTE, FINAL_QUESTIONS_NOTE, forAudience } from "./audience";
import { LEARNER_TEXT_RULE, wrapLearnerText } from "./learnerText";

/**
 * The course boss: once every topic on a map is proven, a final interview of three questions
 * that each mix topics. Each question is saved as an attempt with an open follow-up, so the
 * voice interview and the follow-up route work for it unchanged.
 */
export const FINAL_NODE_ID = "final-interview";
export const FINAL_QUESTIONS = 3;
export const FINAL_PASS_MARK = 2;

/** The store record. ownerId lets "Delete my data" find it, and never goes to the browser. */
export type FinalRecord = {
  mapId: string;
  ownerId: string;
  attemptIds: string[];
  /** Topic titles each question mixes, in the same order. */
  topics: string[][];
  startedAt: string;
  result?: FinalResult;
};

export type FinalResult = { passed: boolean; passedCount: number; spokenCount: number; finishedAt: string };

export type FinalView = {
  state: "locked" | "ready" | "in-progress" | "passed" | "failed";
  questions: { attemptId: string; question: string; topics: string[]; passed: boolean | null }[];
  result: FinalResult | null;
};

export const QUESTIONS_SYSTEM = `You are a friendly interviewer. A learner has just proved every topic in a course. Write ${FINAL_QUESTIONS} questions for a short final interview.

- Each question connects two or three of the listed topics, and asks why something happens or what would happen in a small situation.
- One sentence each, at most 30 words, answerable out loud in two or three sentences. No yes or no questions, no code, no calculations.
- Never put the answer in the question.
- For each question, list the numbers of the topics it mixes.`;

export const ANSWER_SYSTEM = `You decide whether a learner's answer to an interview question shows real understanding. The topics and their key facts are given to help you judge.

- passed is true only if the answer addresses the question and what it says is correct. Plain, informal or spoken wording is fine.
- passed is false if it is evasive, "I don't know", restates the question, changes the subject, or is general wording with no specific fact.
- feedback is exactly one sentence to the learner, saying what was right. If passed is false, write only "Not passed."

${LEARNER_TEXT_RULE}`;

const questionsSchema = z.object({
  questions: z
    .array(z.object({ question: z.string().trim().min(1), topics: z.array(z.number().int()) }))
    .length(FINAL_QUESTIONS),
});

const answerSchema = z.object({ passed: z.boolean(), feedback: z.string().trim().min(1) });

/** Writes the three questions with one AI call, and saves each as an attempt waiting for an answer. */
export async function createFinal(map: SkillMap, ownerId: string): Promise<{ record: FinalRecord; attempts: Attempt[] }> {
  const topicList = map.nodes.map((node, index) => `${index + 1}. ${node.title}: ${node.checkpoints.join("; ")}`).join("\n");
  const reply = await chatJSON({
    label: "teachback-final-questions",
    system: forAudience(QUESTIONS_SYSTEM, map.audience, FINAL_QUESTIONS_NOTE),
    prompt: `Course: ${map.title}\n\nTopics:\n${topicList}`,
    schema: questionsSchema,
    timeoutMs: 20_000,
  });

  const now = new Date().toISOString();
  const attempts: Attempt[] = reply.questions.map((item) => ({
    id: randomUUID(),
    mapId: map.id,
    nodeId: FINAL_NODE_ID,
    ownerId,
    explanation: "",
    integrity: { pasted: false, activeMs: 0, wordCount: 0, inputMethod: "typed" },
    grade: { score: 0, checkpoints: [], misconceptions: [], rejectedQuotes: 0 },
    followUp: { question: item.question, answer: null, passed: null, feedback: null },
    status: "needs-followup",
    createdAt: now,
    format: "final",
  }));
  const record: FinalRecord = {
    mapId: map.id,
    ownerId,
    attemptIds: attempts.map((attempt) => attempt.id),
    topics: reply.questions.map((item) => topicTitles(map, item.topics)),
    startedAt: now,
  };
  return { record, attempts };
}

export async function gradeFinalAnswer(map: SkillMap, question: string, answer: string) {
  if (answer.trim() === "") return { passed: false, feedback: "There was no answer to check." };
  const facts = map.nodes.map((node) => `- ${node.title}: ${node.checkpoints.join("; ")}`).join("\n");
  return chatJSON({
    label: "teachback-final-grade",
    system: forAudience(ANSWER_SYSTEM, map.audience, ANSWER_NOTE),
    prompt: `Course: ${map.title}\n\nTopics and key facts:\n${facts}\n\nQuestion:\n${question}\n\nTheir answer:\n${wrapLearnerText(answer)}`,
    schema: answerSchema,
    timeoutMs: 20_000,
  });
}

/** Works out where the interview stands from its attempts. */
export function finalView(record: FinalRecord | null, attempts: (Attempt | null)[], allProven: boolean): FinalView {
  if (!record) return { state: allProven ? "ready" : "locked", questions: [], result: null };
  const questions = record.attemptIds.map((attemptId, index) => ({
    attemptId,
    question: attempts[index]?.followUp?.question ?? "",
    topics: record.topics[index] ?? [],
    passed: attempts[index]?.followUp?.passed ?? null,
  }));
  const state = record.result ? (record.result.passed ? "passed" : "failed") : "in-progress";
  return { state, questions, result: record.result ?? null };
}

/** Once every question has an answer, saves the result. Two of three passes it. */
export function settle(record: FinalRecord, attempts: (Attempt | null)[]): FinalRecord {
  if (record.result || attempts.some((attempt) => !attempt || attempt.status === "needs-followup")) return record;
  const answered = attempts as Attempt[];
  const passedCount = answered.filter((attempt) => attempt.followUp?.passed).length;
  return {
    ...record,
    result: {
      passed: passedCount >= FINAL_PASS_MARK,
      passedCount,
      spokenCount: answered.filter((attempt) => attempt.followUp?.inputMethod === "voice").length,
      finishedAt: new Date().toISOString(),
    },
  };
}

export async function getFinalRecord(mapId: string): Promise<FinalRecord | null> {
  return getDoc<FinalRecord>(finalKey(mapId));
}

export async function saveFinalRecord(record: FinalRecord): Promise<void> {
  await putDoc(finalKey(record.mapId), record);
}

export function finalKey(mapId: string): string {
  return `final/${mapId}`;
}

function topicTitles(map: SkillMap, numbers: number[]): string[] {
  return [...new Set(numbers)].map((number) => map.nodes[number - 1]?.title).filter((title): title is string => !!title);
}
