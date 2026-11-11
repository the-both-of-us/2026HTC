import { skillBlock } from "@/features/skill-map";
import type { SkillMap, SkillNode } from "@/shared/types";

/**
 * The syllabus lines (objectives, key terms, scope, unit outcomes) a teach-back prompt adds under
 * a topic, or none. A node built before syllabi has none of those fields, so it never reaches
 * `skillBlock` and the prompt stays byte for byte what it was.
 */
export function syllabusLines(map: Pick<SkillMap, "syllabus"> | undefined, node: SkillNode): string[] {
  const hasSyllabus =
    node.unitId !== undefined ||
    node.objectives !== undefined ||
    node.keyTerms !== undefined ||
    node.inScope !== undefined ||
    node.outOfScope !== undefined;
  return map && hasSyllabus ? skillBlock(map, node) : [];
}

/** The lines as a suffix to append to a prompt line: each on its own line, or "" for a legacy node. */
export function syllabusSuffix(map: Pick<SkillMap, "syllabus"> | undefined, node: SkillNode, indent = ""): string {
  return syllabusLines(map, node)
    .map((line) => `\n${indent}${line}`)
    .join("");
}
