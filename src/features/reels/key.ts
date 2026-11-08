import { createHash } from "node:crypto";
import { audienceKey } from "@/shared/audience";
import type { SkillMap, SkillNode } from "@/shared/types";

const normal = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Which saved list a skill uses: a hash of what the skill is about, not of which map holds it.
 * Starting a course copies the map with a new id but the same title and skills, so the course and
 * every learner's copy (and copies of copies) share one list and one YouTube search. The map title
 * keeps "Trees" in biology apart from "Trees" in data structures, and the audience keeps a grade 1
 * map's videos apart from an adult's.
 */
export function topicKey(map: Pick<SkillMap, "title" | "audience">, node: Pick<SkillNode, "id" | "title">): string {
  const parts = [normal(map.title), node.id, normal(node.title), audienceKey(map.audience)];
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}
