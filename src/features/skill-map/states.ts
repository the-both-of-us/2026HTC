import type { MapProgress, NodeState, SkillNode } from "@/shared/types";

/**
 * Works out what the learner can do with each node.
 * Proven stays proven. Otherwise a node is available once all its prerequisites
 * are proven, or once the learner unlocked it anyway, and locked until then.
 */
export function deriveNodeStates(
  map: { nodes: Pick<SkillNode, "id" | "prerequisites">[] },
  progress: Pick<MapProgress, "proven" | "unlocked"> | null,
): Record<string, NodeState> {
  const proven = progress?.proven ?? {};
  const unlocked = progress?.unlocked ?? {};
  const states: Record<string, NodeState> = {};

  for (const node of map.nodes) {
    if (proven[node.id]) {
      states[node.id] = "proven";
    } else if (unlocked[node.id] || node.prerequisites.every((prerequisite) => proven[prerequisite])) {
      states[node.id] = "available";
    } else {
      states[node.id] = "locked";
    }
  }

  return states;
}

/**
 * Skills that are open only because the learner unlocked them anyway: their prerequisites
 * are not all proven yet. Once they are, the skill would be open anyway, so it drops out.
 */
export function unlockedEarlyIds(
  map: { nodes: Pick<SkillNode, "id" | "prerequisites">[] },
  progress: Pick<MapProgress, "proven" | "unlocked"> | null,
): Set<string> {
  const proven = progress?.proven ?? {};
  const unlocked = progress?.unlocked ?? {};
  return new Set(
    map.nodes
      .filter((node) => unlocked[node.id] && !node.prerequisites.every((prerequisite) => proven[prerequisite]))
      .map((node) => node.id),
  );
}
