import type { MapProgress, NodeState, SkillNode } from "@/shared/types";

/**
 * Works out what the learner can do with each node.
 * Proven stays proven. Otherwise a node is available once all its prerequisites
 * are proven, and locked until then.
 */
export function deriveNodeStates(
  map: { nodes: Pick<SkillNode, "id" | "prerequisites">[] },
  progress: Pick<MapProgress, "proven"> | null,
): Record<string, NodeState> {
  const proven = progress?.proven ?? {};
  const states: Record<string, NodeState> = {};

  for (const node of map.nodes) {
    if (proven[node.id]) {
      states[node.id] = "proven";
    } else if (node.prerequisites.every((prerequisite) => proven[prerequisite])) {
      states[node.id] = "available";
    } else {
      states[node.id] = "locked";
    }
  }

  return states;
}
