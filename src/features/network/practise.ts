import "server-only";
import { deriveNodeStates, listMapsByOwner } from "@/features/skill-map";
import { getProgress } from "@/features/teachback";
import type { NodeState } from "@/shared/types";
import { skillsMatch } from "./matching";

/** The longest skill title "Practise this" accepts. Real titles are far shorter. */
export const MAX_PRACTISE_SKILL_LENGTH = 200;

/** Open skills first, so "Practise this" lands on something you can start now. */
const STATE_ORDER: Record<NodeState, number> = { available: 0, locked: 1, proven: 2 };

/**
 * Where "Practise this" goes for one skill title: that skill on the viewer's own map, as
 * `/map/<id>?skill=<nodeId>`, or null if none of their maps has it. Only the viewer's own
 * maps are read, so a map id only ever goes back to its owner, in a redirect.
 *
 * A skill they have not proved wins over one they have, an open one over a locked one, and
 * the newest map on a tie (listMapsByOwner is newest first).
 */
export async function findPractiseLink(userId: string, skillTitle: string): Promise<string | null> {
  const title = skillTitle.trim();
  if (!title || title.length > MAX_PRACTISE_SKILL_LENGTH) return null;

  const maps = await listMapsByOwner(userId);
  let best: { href: string; rank: number } | null = null;

  for (const map of maps) {
    const matches = map.nodes.filter((node) => skillsMatch(node.title, title));
    if (matches.length === 0) continue;

    const states = deriveNodeStates(map, await getProgress(map.id, userId));
    for (const node of matches) {
      const rank = STATE_ORDER[states[node.id] ?? "locked"];
      if (!best || rank < best.rank) {
        best = { href: `/map/${map.id}?skill=${encodeURIComponent(node.id)}`, rank };
      }
    }
    if (best?.rank === 0) break;
  }

  return best?.href ?? null;
}

/** Where to go when none of your maps has the skill: courses that teach it. */
export function findCoursesHref(skillTitle: string): string {
  return `/courses?q=${encodeURIComponent(skillTitle.trim().slice(0, MAX_PRACTISE_SKILL_LENGTH))}`;
}
