import type { CourseSyllabus, NodeState, SkillNode } from "@/shared/types";
import { unitOfNode } from "./skillBlock";

/*
 * Pure helpers for the unit rail and progress on a map built from a syllabus. No React, no store:
 * the map screen and the server can both use them. Every number is counted from the syllabus and
 * the map's nodes, never written by a model.
 */

/** One unit as the rail shows it. */
export type UnitRailItem = {
  id: string;
  /** 1-based. */
  number: number;
  title: string;
  /** Topics planned for the unit (once built, the topics that really have a node). */
  plannedTopics: number;
  /** True once its nodes are in the map. */
  built: boolean;
  /** Ids of its nodes in the map, in map order. Empty until built. */
  nodeIds: string[];
  /** Its topic titles, so an unbuilt unit can show what it will cover. */
  topicTitles: string[];
  /** Topics proved. For an unbuilt unit, topics known from the pre-test (when `proven` was passed). */
  proved: number;
  /**
   * - "built": its nodes are in the map;
   * - "ready": not built, and the unit before it is half proved, so it can be started;
   * - "locked": not built, and the unit before it is not half proved yet (or not built).
   */
  status: "built" | "ready" | "locked";
  /** For a locked unit: topics of the unit before that must be proved first, and how many are. */
  waitingFor: { unitNumber: number; needed: number; proved: number } | null;
};

/** Unit k+1 opens once half of unit k is proved: this many of its topics, rounded up. */
export function unitStartRule(plannedTopics: number): number {
  return Math.ceil(plannedTopics / 2);
}

type RailNode = Pick<SkillNode, "id" | "unitId" | "topicId">;

/**
 * The rail, in syllabus order. A node whose unit cannot be found (there should be none) counts in
 * the first unit, so every node is always on some unit's canvas.
 */
export function unitRail(
  syllabus: Pick<CourseSyllabus, "units">,
  nodes: RailNode[],
  states: Record<string, NodeState>,
  /**
   * The learner's proofs by topic id (`MapProgress.proven`). Optional: when given, an unbuilt
   * unit counts its topics already proved, which only a pre-test pass can do before a unit is built.
   */
  proven?: Record<string, string>,
): UnitRailItem[] {
  const firstId = syllabus.units[0]?.id;
  const idsByUnit = new Map<string, string[]>();
  for (const node of nodes) {
    const unitId = unitOfNode(syllabus, node)?.id ?? firstId;
    if (!unitId) continue;
    idsByUnit.set(unitId, [...(idsByUnit.get(unitId) ?? []), node.id]);
  }

  const items: UnitRailItem[] = [];
  syllabus.units.forEach((unit, index) => {
    const nodeIds = idsByUnit.get(unit.id) ?? [];
    const built = unit.built || (unit.topics.length > 0 && unit.topics.every((topic) => nodeIds.includes(topic.id)));
    const plannedTopics = built ? nodeIds.length : unit.topics.length;
    const proved = built || nodeIds.length > 0
      ? nodeIds.filter((id) => states[id] === "proven").length
      : unit.topics.filter((topic) => proven?.[topic.id]).length;
    const previous = items[index - 1];
    let status: UnitRailItem["status"] = "built";
    let waitingFor: UnitRailItem["waitingFor"] = null;
    if (!built) {
      const needed = previous ? unitStartRule(previous.plannedTopics) : 0;
      const open = !previous || (previous.built && previous.proved >= needed);
      status = open ? "ready" : "locked";
      if (!open && previous) waitingFor = { unitNumber: previous.number, needed, proved: previous.proved };
    }
    items.push({
      id: unit.id,
      number: index + 1,
      title: unit.title,
      plannedTopics,
      built,
      nodeIds,
      topicTitles: unit.topics.map((topic) => topic.title),
      proved,
      status,
      waitingFor,
    });
  });
  return items;
}

/** Topics planned across the whole course, built or not: what course progress is counted against. */
export function plannedTopicTotal(rail: UnitRailItem[]): number {
  return rail.reduce((sum, unit) => sum + unit.plannedTopics, 0);
}

/**
 * The unit the rail opens on: the one holding `nodeId` when given, else the first built unit
 * with a topic left to prove, else the last built one.
 */
export function initialUnitId(rail: UnitRailItem[], nodeId: string | null): string | null {
  if (nodeId) {
    const holding = rail.find((unit) => unit.nodeIds.includes(nodeId));
    if (holding) return holding.id;
  }
  const built = rail.filter((unit) => unit.built);
  return (built.find((unit) => unit.proved < unit.nodeIds.length) ?? built.at(-1) ?? rail[0])?.id ?? null;
}
