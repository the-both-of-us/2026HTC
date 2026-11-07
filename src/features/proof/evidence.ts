import { getSkillMap } from "@/features/skill-map";
import { getAttempt, getProgress, toLearnerView, type LearnerAttempt } from "@/features/teachback";
import type { Citation, SkillNode, SourceKind } from "@/shared/types";

export type ProvenSkill = {
  id: string;
  title: string;
  why: string;
  fromSource: boolean;
  citation: Citation | null;
  attempt: LearnerAttempt;
};

/** Everything the public page shows. It never holds ownerId or the source text. */
export type Evidence = {
  mapId: string;
  title: string;
  subtitle: string;
  sourceKind: SourceKind;
  totalSkills: number;
  proven: ProvenSkill[];
  notProven: string[];
  /** True when the person looking built this map, so the page can link back to it. */
  viewerIsOwner: boolean;
};

/** Returns a map's evidence, or null if there is no such map. Anyone with the link may read it. */
export async function getEvidence(mapId: string, viewerId: string | null): Promise<Evidence | null> {
  const map = await getSkillMap(mapId);
  if (!map) return null;

  const progress = await getProgress(map.id, map.ownerId);
  const results = await Promise.all(
    map.nodes.map(async (node) => {
      const attemptId = progress?.proven[node.id];
      const attempt = attemptId ? await getAttempt(attemptId) : null;
      // The attempt must back up the claim, or the skill doesn't count here.
      return { node, proven: attempt?.status === "proven" ? toProvenSkill(node, attempt) : null };
    }),
  );

  return {
    mapId: map.id,
    title: map.title,
    subtitle: map.subtitle,
    sourceKind: map.sourceKind,
    totalSkills: map.nodes.length,
    proven: results.flatMap((result) => (result.proven ? [result.proven] : [])),
    notProven: results.filter((result) => !result.proven).map((result) => result.node.title),
    viewerIsOwner: viewerId === map.ownerId,
  };
}

function toProvenSkill(node: SkillNode, attempt: Parameters<typeof toLearnerView>[0]): ProvenSkill {
  return {
    id: node.id,
    title: node.title,
    why: node.why,
    fromSource: node.fromSource,
    citation: node.citation,
    attempt: toLearnerView(attempt),
  };
}
