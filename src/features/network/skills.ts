/** Works out a person's skills from their own maps and progress. Nobody can type a proven skill. */
import { getOwnProofForMap } from "@/features/proof";
import { deriveNodeStates, listMapsByOwner } from "@/features/skill-map";
import { getProgress } from "@/features/teachback";
import type { SkillMap } from "@/shared/types";
import { toSkillSet } from "./matching";
import type { DemoSkills, ProvenSkill, SkillSet } from "./types";

export const NO_SKILLS: SkillSet = { proven: [], learning: [], hasMaps: false };

/**
 * The node ids shown on the owner's live evidence page for this map, and its public path.
 * A skill proved after the page was published is not on it, so it gets no link.
 */
async function evidenceFor(userId: string, map: SkillMap): Promise<{ path: string; nodeIds: Set<string> } | null> {
  try {
    const record = await getOwnProofForMap(userId, map.id);
    if (!record || record.state !== "live" || record.ownerId !== userId) return null;
    return { path: `/proof/${record.id}`, nodeIds: new Set(record.snapshot.skills.map((skill) => skill.nodeId)) };
  } catch (error) {
    // A missing evidence page only costs a link, so the rest of the profile still shows.
    console.error("[network] could not read an evidence page", error);
    return null;
  }
}

async function skillsOnMap(userId: string, map: SkillMap): Promise<{ proven: ProvenSkill[]; learning: string[] }> {
  const progress = await getProgress(map.id, userId);
  const states = deriveNodeStates(map, progress);
  const anyProven = map.nodes.some((node) => states[node.id] === "proven");
  const evidence = anyProven ? await evidenceFor(userId, map) : null;

  const proven: ProvenSkill[] = [];
  const learning: string[] = [];
  for (const node of map.nodes) {
    if (states[node.id] === "proven") {
      proven.push({
        title: node.title,
        mapTitle: map.title,
        evidenceUrl: evidence?.nodeIds.has(node.id) ? evidence.path : null,
      });
    } else {
      learning.push(node.title);
    }
  }
  return { proven, learning };
}

/**
 * Everything one person has proved and is learning, across all their maps (newest first).
 * Proven titles are deduplicated ignoring case; learning leaves out anything already proved.
 */
export async function computeSkills(userId: string): Promise<SkillSet> {
  const maps = (await listMapsByOwner(userId)).filter((map) => map.ownerId === userId);
  if (maps.length === 0) return NO_SKILLS;
  const perMap = await Promise.all(maps.map((map) => skillsOnMap(userId, map)));
  return toSkillSet(
    perMap.flatMap((entry) => entry.proven),
    perMap.flatMap((entry) => entry.learning),
    true,
  );
}

/** A demo profile's made-up skills, written by the seed. They have no evidence pages. */
export function demoSkillSet(demo: DemoSkills | undefined): SkillSet {
  if (!demo) return NO_SKILLS;
  return toSkillSet(
    demo.proven.map((skill) => ({ title: skill.title, mapTitle: skill.mapTitle, evidenceUrl: null })),
    demo.learning,
    true,
  );
}
