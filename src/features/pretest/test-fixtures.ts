/*
 * Tests only: a catalog course with a final syllabus of 3 units x 4 topics, a learner map with
 * unit 1 built, a fake chatJSON for the pre-test calls, and seeded question sets. Nothing in the
 * app imports this file.
 */
import { randomUUID } from "node:crypto";
import { putDoc } from "@/shared/store";
import type { CourseSyllabus, SkillMap, SkillNode, SyllabusUnit } from "@/shared/types";
import type { PretestQuestionSet } from "./types";

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

export function questionSet(courseId: string, unit: SyllabusUnit): PretestQuestionSet {
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

/**
 * A stand-in for chatJSON. Questions: one per "- id:" line of the prompt, with key points holding
 * KEY_MARK. Grading: an answer containing "RIGHT" is correct.
 */
export function fakeChat(options: { label: string; prompt: string }): unknown {
  if (options.label === "pretest-questions") {
    const ids = [...options.prompt.matchAll(/^- id: (\S+)$/gm)].map((match) => match[1]);
    return { questions: ids.map((id) => ({ topicId: id, question: `What does ${id} do?`, keyPoints: [`${KEY_MARK} ${id} a.`, `${KEY_MARK} ${id} b.`] })) };
  }
  if (options.label === "pretest-grade") {
    const items = options.prompt.split(/^Item \d+$/m).slice(1);
    return { verdicts: items.map((item, index) => ({ item: index + 1, correct: /RIGHT/.test(item.split("<learner_answer>")[1] ?? "") })) };
  }
  throw new Error(`unexpected call ${options.label}`);
}
