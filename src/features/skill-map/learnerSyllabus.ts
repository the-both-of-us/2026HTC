import type { CourseSyllabus, SkillNode } from "@/shared/types";

/**
 * The canonical syllabus of a catalog course as one learner's map shows it. Pure: no store.
 * - `built` comes from the learner's own nodes: a unit is built once any of its nodes is in the map;
 * - a built unit's topics are cut down to those with a node, so the planned count is what the
 *   learner can prove (a topic the unit build could not write is never counted);
 * - `rootMapId` is the courseId (the canonical content id), never a map id;
 * - `planning: true` while the syllabus is still being written (units committed so far).
 */
export function syllabusForLearner(
  canonical: CourseSyllabus,
  nodes: Pick<SkillNode, "id" | "unitId" | "topicId">[],
  courseId: string,
  planning: boolean,
): CourseSyllabus {
  const { planning: wasPlanning, ...rest } = canonical;
  void wasPlanning;
  return {
    ...rest,
    rootMapId: courseId,
    ...(planning && { planning: true }),
    units: canonical.units.map((unit) => {
      const topicIds = new Set(unit.topics.map((topic) => topic.id));
      const have = new Set(
        nodes.filter((node) => node.unitId === unit.id || topicIds.has(node.topicId ?? node.id)).map((node) => node.topicId ?? node.id),
      );
      if (have.size === 0) return { ...unit, built: false };
      return { ...unit, built: true, topics: unit.topics.filter((topic) => have.has(topic.id)) };
    }),
  };
}
