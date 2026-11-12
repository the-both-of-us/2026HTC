/*
 * Tests only: a catalog course with a final syllabus of 3 units x 4 topics, a learner map with
 * unit 1 built, a fake chatJSON for the pre-test calls, and seeded question sets. Nothing in the
 * app imports this file.
 */
import { randomUUID } from "node:crypto";
import { getDoc, putDoc } from "@/shared/store";
import type { CourseSyllabus, SkillMap, SkillNode, SyllabusUnit } from "@/shared/types";
import { presentSet, seedOf } from "./layout";
import type { PretestAnswersRequest, PretestQuestionSet, PretestRecord } from "./types";

/** Every answer key in the fixtures contains this, so a test can look for it in any reply. */
export const KEY_MARK = "ANSWERKEY";

export function makeSyllabus(units = 3, topicsPerUnit = 4): CourseSyllabus {
  return {
    version: 1,
    courseSlug: "system-design",
    outcomes: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, text: `Outcome ${n}.` })),
    units: Array.from({ length: units }, (_, u): SyllabusUnit => ({
      id: `u${u + 1}`,
      title: `Unit ${u + 1}`,
      outcomeIds: ["o1"],
      built: false,
      topics: Array.from({ length: topicsPerUnit }, (_, t) => ({
        id: `u${u + 1}-t${t + 1}`,
        title: `Topic ${u + 1}.${t + 1}`,
        objectives: ["Explain it.", "Use it."],
        keyTerms: ["alpha", "beta", "gamma"],
        inScope: "What it covers.",
        outOfScope: "What it leaves out.",
        buildsOn: t > 0 ? [`u${u + 1}-t${t}`] : [],
      })),
    })),
    assessment: { unitTests: true, finalQuestions: 6 },
  };
}

export function nodesOf(syllabus: CourseSyllabus, unitId: string): SkillNode[] {
  const unit = syllabus.units.find((candidate) => candidate.id === unitId)!;
  return unit.topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    why: "Needed.",
    prerequisites: topic.buildsOn,
    fromSource: false,
    citation: null,
    checkpoints: ["One fact.", "Two facts."],
    unitId: unit.id,
    topicId: topic.id,
  }));
}

/** A catalog course, its final syllabus, and one learner's map of it with unit 1 built. */
export async function seedCourse(options: { courseId?: string; ownerId?: string } = {}) {
  const courseId = options.courseId ?? randomUUID();
  const ownerId = options.ownerId ?? randomUUID();
  const syllabus = makeSyllabus();
  await putDoc(`catalog/courses/${courseId}`, {
    id: courseId,
    title: "System design",
    summary: "Design systems.",
    audience: "",
    createdAt: new Date().toISOString(),
  });
  await putDoc(`catalog/syllabi/${courseId}`, { ...syllabus, rootMapId: courseId });
  const map = await seedMap(courseId, ownerId, syllabus);
  return { courseId, ownerId, syllabus, map };
}

export async function seedMap(courseId: string, ownerId: string, syllabus: CourseSyllabus): Promise<SkillMap> {
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    courseId,
    title: "System design",
    subtitle: "",
    sourceKind: "topic",
    sourceText: "System design",
    nodes: nodesOf(syllabus, "u1"),
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${map.id}`, map);
  return map;
}

export async function seedPostingMap(ownerId: string, sourceKind: "posting" | "pdf" = "posting"): Promise<SkillMap> {
  const syllabus = makeSyllabus(1);
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    title: "Data analyst",
    subtitle: "",
    sourceKind,
    sourceText: "Strong SQL required.",
    nodes: nodesOf(syllabus, "u1"),
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${map.id}`, map);
  return map;
}

/** Every explanation in the fixtures contains KEY_MARK; the correct option of a topic is `Right: <topicId>`. */
export function mcQuestion(topicId: string, title = topicId) {
  return {
    topicId,
    question: `What does ${title} do?`,
    options: [`Right: ${topicId}`, `Wrong A for ${topicId}`, `Wrong B for ${topicId}`, `Wrong C for ${topicId}`],
    explanation: `${KEY_MARK} ${topicId} explains why Right is right.`,
  };
}

export function questionSet(courseId: string, unit: SyllabusUnit): PretestQuestionSet {
  return {
    courseId,
    unitId: unit.id,
    questions: unit.topics.map((topic) => mcQuestion(topic.id, topic.title)),
    createdAt: new Date().toISOString(),
  };
}

/** A set as written before multiple choice: short-answer questions with key points. */
export function oldShapeSet(courseId: string, unit: SyllabusUnit) {
  return {
    courseId,
    unitId: unit.id,
    questions: unit.topics.map((topic) => ({ topicId: topic.id, question: `What does ${topic.title} do?`, keyPoints: [`${KEY_MARK} ${topic.id} a.`, `${KEY_MARK} ${topic.id} b.`] })),
    createdAt: new Date().toISOString(),
  };
}

export async function seedSets(courseId: string, syllabus: CourseSyllabus): Promise<void> {
  for (const unit of syllabus.units) await putDoc(`pretest-sets/${courseId}/${unit.id}`, questionSet(courseId, unit));
}

/** A stand-in for chatJSON: one multiple-choice question per "- id:" line of the prompt, the correct option first. */
export function fakeChat(options: { label: string; prompt: string }): unknown {
  if (options.label === "pretest-questions") {
    const ids = [...options.prompt.matchAll(/^- id: (\S+)$/gm)].map((match) => match[1]);
    return { questions: ids.map((id) => mcQuestion(id)) };
  }
  throw new Error(`unexpected call ${options.label}`);
}

export type Pick = "right" | "wrong" | "dk";

/**
 * The body of an answers request for one unit. The option order is this learner's own, so the index
 * of the right option is read from their record and the stored set. "dk" is "I don't know this" (null).
 */
export async function answersFor(map: SkillMap, unitId: string, picks: Record<string, Pick>): Promise<PretestAnswersRequest> {
  const record = await getDoc<PretestRecord>(`pretest/${map.courseId}/${map.ownerId}`);
  const set = await getDoc<PretestQuestionSet>(`pretest-sets/${map.courseId}/${unitId}`);
  const presented = presentSet(set as PretestQuestionSet, seedOf(record as PretestRecord));
  return {
    unitId,
    answers: Object.entries(picks).map(([topicId, pick]) => {
      const { correctIndex } = presented.find((question) => question.topicId === topicId) as { correctIndex: number };
      return { topicId, choice: pick === "right" ? correctIndex : pick === "wrong" ? (correctIndex + 1) % 4 : null };
    }),
  };
}
