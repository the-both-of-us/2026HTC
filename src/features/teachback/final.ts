import { randomUUID } from "node:crypto";
import { z } from "zod";
import { chatJSON } from "@/features/ai";
import { HttpError } from "@/shared/http";
import { getDoc, putDoc } from "@/shared/store";
import { SYLLABUS_SHAPE, UNIT_TEST, unitTestNodeId, type Attempt, type SkillMap, type SkillNode } from "@/shared/types";
import { ANSWER_NOTE, FINAL_QUESTIONS_NOTE, forAudience } from "./audience";
import { LEARNER_TEXT_RULE, wrapLearnerText } from "./learnerText";
import { CHECK_MAX_TOKENS, CHECK_TOTAL_MS } from "./grading";
import { syllabusSuffix } from "./skillLines";

/**
 * The course boss: once every topic on a map is proven, a final interview of three questions
 * that each mix topics. Each question is saved as an attempt with an open follow-up, so the
 * voice interview and the follow-up route work for it unchanged.
 *
 * A degree course (map.syllabus.depth "degree") has a 6-question final with pass mark 4, and a
 * 4-question unit test (pass mark 3) after each unit, stored the same way under node id
 * `final:<unitId>` and key `final/<mapId>/<unitId>`. The constants below are the quick course's.
 */
export const FINAL_NODE_ID = "final-interview";
export const FINAL_QUESTIONS = 3;
export const FINAL_PASS_MARK = 2;

/** Whether an attempt's node id is a final or a unit test, so there is no skill on the map for it. */
export function isFinalNodeId(nodeId: string): boolean {
  return nodeId === FINAL_NODE_ID || nodeId.startsWith("final:");
}

/** The unit a unit test's node id names ("final:u2" gives "u2"), or null for the course final or a skill. */
export function unitIdOfFinal(nodeId: string): string | null {
  return nodeId.startsWith("final:") && nodeId.length > "final:".length ? nodeId.slice("final:".length) : null;
}

/** What one final or unit test asks: which topics it covers, how many questions, and how many must pass. */
export type FinalPlan = {
  kind: "course" | "unit";
  /** Node id its attempts carry. */
  nodeId: string;
  unitId?: string;
  unitTitle?: string;
  questions: number;
  passMark: number;
  /** The topics it covers, in the order the question writer numbers them. */
  nodes: SkillNode[];
};

/**
 * The plan for a course final (no `unitId`) or one unit's test. A course final covers every topic
 * and is 3 questions with pass mark 2, or 6 with pass mark 4 for a degree course. A unit test
 * covers that unit's topics: 4 questions, pass mark 3. Throws a 404 for a unit test on a map
 * whose syllabus has no unit tests or no such unit.
 */
export function finalPlan(map: SkillMap, unitId?: string): FinalPlan {
  if (unitId === undefined) {
    const degree = map.syllabus?.depth === "degree";
    return {
      kind: "course",
      nodeId: FINAL_NODE_ID,
      questions: degree ? SYLLABUS_SHAPE.degree.finalQuestions : FINAL_QUESTIONS,
      passMark: degree ? SYLLABUS_SHAPE.degree.finalPassMark : FINAL_PASS_MARK,
      nodes: map.nodes,
    };
  }
  const unit = map.syllabus?.assessment.unitTests ? map.syllabus.units.find((candidate) => candidate.id === unitId) : undefined;
  if (!unit) throw new HttpError("This course has no test for that unit.", 404);
  return {
    kind: "unit",
    nodeId: unitTestNodeId(unit.id),
    unitId: unit.id,
    unitTitle: unit.title,
    questions: UNIT_TEST.questions,
    passMark: UNIT_TEST.passMark,
    nodes: map.nodes.filter((node) => node.unitId === unit.id),
  };
}

/** The store record. ownerId lets "Delete my data" find it, and never goes to the browser. */
export type FinalRecord = {
  mapId: string;
  ownerId: string;
  /** Set on a unit test. Absent on the course final. */
  unitId?: string;
  /** Pass mark in force when it was written. Absent on records from before degree courses: 2 of 3. */
  passMark?: number;
  attemptIds: string[];
  /** Topic titles each question mixes, in the same order. */
  topics: string[][];
  startedAt: string;
  result?: FinalResult;
};

export type FinalResult = { passed: boolean; passedCount: number; spokenCount: number; finishedAt: string };

export type FinalView = {
  state: "locked" | "ready" | "in-progress" | "passed" | "failed";
  /** Set on a unit test. */
  unitId?: string;
  /** How many questions it asks and how many must pass. */
  questionCount?: number;
  passMark?: number;
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

const COURSE_INTRO = "A learner has just proved every topic in a course. Write 3 questions for a short final interview.";

/**
 * The question writer's prompt for a plan. The quick course's is QUESTIONS_SYSTEM, byte for byte.
 * A degree course's final asks for more questions spread over the whole course, and a unit test
 * is about that unit only.
 */
export function questionsSystem(plan: Pick<FinalPlan, "kind" | "questions">): string {
  if (plan.kind === "course" && plan.questions === FINAL_QUESTIONS) return QUESTIONS_SYSTEM;
  if (!QUESTIONS_SYSTEM.includes(COURSE_INTRO)) throw new Error("Final questions prompt intro moved.");
  const intro =
    plan.kind === "unit"
      ? `A learner has just proved every topic in one unit of a course. Write ${plan.questions} questions for a short unit test on that unit only.`
      : `A learner has just proved every topic in a course and passed each unit test. Write ${plan.questions} questions for the final interview. Spread them across the whole course, so no unit is left out.`;
  return QUESTIONS_SYSTEM.replace(COURSE_INTRO, intro);
}

const questionsSchema = (count: number) =>
  z.object({
    questions: z.array(z.object({ question: z.string().trim().min(1), topics: z.array(z.number().int()) })).length(count),
  });

const answerSchema = z.object({ passed: z.boolean(), feedback: z.string().trim().min(1) });

/**
 * Writes the questions with one AI call, and saves each as an attempt waiting for an answer.
 * The plan decides the topics, the question count and the pass mark: the course final by default.
 */
export async function createFinal(
  map: SkillMap,
  ownerId: string,
  plan: FinalPlan = finalPlan(map),
): Promise<{ record: FinalRecord; attempts: Attempt[] }> {
  // A degree course's final lists 30 to 50 topics, so it leaves out the syllabus lines to stay a prompt of a sane size.
  const withLines = !(plan.kind === "course" && map.syllabus?.depth === "degree");
  const topicList = plan.nodes
    .map((node, index) => `${index + 1}. ${node.title}: ${node.checkpoints.join("; ")}${withLines ? syllabusSuffix(map, node, "   ") : ""}`)
    .join("\n");
  const reply = await chatJSON({
    profile: "write",
    label: "teachback-final-questions",
    system: forAudience(questionsSystem(plan), map.audience, FINAL_QUESTIONS_NOTE),
    prompt: `Course: ${map.title}\n${plan.kind === "unit" ? `Unit: ${plan.unitTitle}\n` : ""}\nTopics:\n${topicList}`,
    schema: questionsSchema(plan.questions),
    maxTokens: 6_000,
    totalMs: 40_000,
  });

  const now = new Date().toISOString();
  const attempts: Attempt[] = reply.questions.map((item) => ({
    id: randomUUID(),
    mapId: map.id,
    nodeId: plan.nodeId,
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
    ...(plan.unitId !== undefined && { unitId: plan.unitId }),
    // Only a plan that differs from the old final writes it, so quick records stay as they were.
    ...(plan.passMark !== FINAL_PASS_MARK && { passMark: plan.passMark }),
    attemptIds: attempts.map((attempt) => attempt.id),
    topics: reply.questions.map((item) => topicTitles(plan.nodes, item.topics)),
    startedAt: now,
  };
  return { record, attempts };
}

/**
 * `nodes` are the topics whose key facts the grader sees: all of the map's by default, a unit's
 * for a unit test, and the question's own topics for a degree course's long final.
 */
export async function gradeFinalAnswer(map: SkillMap, question: string, answer: string, nodes: SkillNode[] = map.nodes) {
  if (answer.trim() === "") return { passed: false, feedback: "There was no answer to check." };
  const facts = nodes.map((node) => `- ${node.title}: ${node.checkpoints.join("; ")}`).join("\n");
  return chatJSON({
    profile: "check",
    label: "teachback-final-grade",
    system: forAudience(ANSWER_SYSTEM, map.audience, ANSWER_NOTE),
    prompt: `Course: ${map.title}\n\nTopics and key facts:\n${facts}\n\nQuestion:\n${question}\n\nTheir answer:\n${wrapLearnerText(answer)}`,
    schema: answerSchema,
    maxTokens: CHECK_MAX_TOKENS,
    totalMs: CHECK_TOTAL_MS,
  });
}

/** Works out where the interview stands from its attempts. `plan` adds the pass mark and unit to the view. */
export function finalView(
  record: FinalRecord | null,
  attempts: (Attempt | null)[],
  allProven: boolean,
  plan?: Pick<FinalPlan, "unitId" | "questions" | "passMark">,
): FinalView {
  const meta = {
    ...(plan?.unitId !== undefined && { unitId: plan.unitId }),
    ...(plan && { questionCount: record?.attemptIds.length || plan.questions, passMark: record?.passMark ?? plan.passMark }),
  };
  if (!record) return { state: allProven ? "ready" : "locked", ...meta, questions: [], result: null };
  const questions = record.attemptIds.map((attemptId, index) => ({
    attemptId,
    question: attempts[index]?.followUp?.question ?? "",
    topics: record.topics[index] ?? [],
    passed: attempts[index]?.followUp?.passed ?? null,
  }));
  const state = record.result ? (record.result.passed ? "passed" : "failed") : "in-progress";
  return { state, ...meta, questions, result: record.result ?? null };
}

/** Once every question has an answer, saves the result. The record's pass mark decides: 2 of 3 unless it says otherwise. */
export function settle(record: FinalRecord, attempts: (Attempt | null)[]): FinalRecord {
  if (record.result || attempts.some((attempt) => !attempt || attempt.status === "needs-followup")) return record;
  const answered = attempts as Attempt[];
  const passedCount = answered.filter((attempt) => attempt.followUp?.passed).length;
  return {
    ...record,
    result: {
      passed: passedCount >= (record.passMark ?? FINAL_PASS_MARK),
      passedCount,
      spokenCount: answered.filter((attempt) => attempt.followUp?.inputMethod === "voice").length,
      finishedAt: new Date().toISOString(),
    },
  };
}

/** The course final's record, or a unit test's when `unitId` is given. */
export async function getFinalRecord(mapId: string, unitId?: string): Promise<FinalRecord | null> {
  return getDoc<FinalRecord>(finalKey(mapId, unitId));
}

export async function saveFinalRecord(record: FinalRecord): Promise<void> {
  await putDoc(finalKey(record.mapId, record.unitId), record);
}

/** `final/<mapId>` for the course final, `final/<mapId>/<unitId>` for a unit test. */
export function finalKey(mapId: string, unitId?: string): string {
  return unitId === undefined ? `final/${mapId}` : `final/${mapId}/${unitId}`;
}

function topicTitles(nodes: SkillNode[], numbers: number[]): string[] {
  return [...new Set(numbers)].map((number) => nodes[number - 1]?.title).filter((title): title is string => !!title);
}
