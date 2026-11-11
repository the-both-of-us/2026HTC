import type { CourseSyllabus, SkillMap, SkillNode, SyllabusTopic, SyllabusUnit } from "@/shared/types";

/** The default cleaner: removes any `<skill>` tag, so the data cannot close the block early. */
function stripSkillTags(text: string): string {
  return text.replace(/<\/?skill>/gi, "").trim();
}

/** The unit a node belongs to: its own `unitId`, else the unit whose topics list it. */
export function unitOfNode(
  syllabus: Pick<CourseSyllabus, "units"> | undefined,
  node: Pick<SkillNode, "id" | "unitId" | "topicId">,
): SyllabusUnit | undefined {
  if (!syllabus) return undefined;
  const topicId = node.topicId ?? node.id;
  return (
    syllabus.units.find((unit) => unit.id === node.unitId) ??
    syllabus.units.find((unit) => unit.topics.some((topic) => topic.id === topicId))
  );
}

function topicOfNode(unit: SyllabusUnit | undefined, node: Pick<SkillNode, "id" | "topicId">): SyllabusTopic | undefined {
  const topicId = node.topicId ?? node.id;
  return unit?.topics.find((topic) => topic.id === topicId);
}

/**
 * The syllabus lines a study-tool prompt adds inside its `<skill>` block: the node's objectives,
 * key terms, in-scope and out-of-scope sentences, and the outcomes of its unit (from
 * `map.syllabus`). Each prompt spreads the lines into its own block wherever it chooses, so its
 * existing lines stay as they are.
 *
 * Returns [] when neither the node nor the map's syllabus has any of those fields for it (every
 * node built before syllabi), so the prompt text is byte for byte what it was and the pinned
 * prompt hashes do not change. A node built before syllabi whose course was later given one (its
 * id is a topic id in `map.syllabus`) gets the topic's fields.
 *
 * `clean` is applied to every piece of model-bound text: pass the prompt's own tag-stripper.
 * The default strips `<skill>` tags.
 *
 * ```
 * Unit: Biological bases of behaviour
 * Unit outcomes:
 * - Explain how neurons communicate
 * Objectives:
 * - Describe an action potential
 * Key terms: neuron, synapse, neurotransmitter
 * Covers: How a signal crosses a synapse.
 * Leaves out: Hormones, which the next topic covers.
 * ```
 */
export function skillBlock(
  map: Pick<SkillMap, "syllabus">,
  node: SkillNode,
  clean: (text: string) => string = stripSkillTags,
): string[] {
  const unit = unitOfNode(map.syllabus, node);
  const topic = topicOfNode(unit, node);
  const tidy = (items: string[] | undefined) => (items ?? []).map((item) => clean(item)).filter(Boolean);

  const objectives = tidy(node.objectives ?? topic?.objectives);
  const keyTerms = tidy(node.keyTerms ?? topic?.keyTerms);
  const inScope = clean(node.inScope ?? topic?.inScope ?? "");
  const outOfScope = clean(node.outOfScope ?? topic?.outOfScope ?? "");
  const hasTopicFields = objectives.length > 0 || keyTerms.length > 0 || inScope !== "" || outOfScope !== "";
  // A node with nothing of its own and no topic in a syllabus is a legacy node: no lines at all.
  if (!hasTopicFields && !node.unitId && !node.topicId && !topic) return [];

  const outcomeById = new Map((map.syllabus?.outcomes ?? []).map((outcome) => [outcome.id, outcome.text]));
  const outcomes = tidy(unit?.outcomeIds.flatMap((id) => outcomeById.get(id) ?? []));
  const unitTitle = unit ? clean(unit.title) : "";

  return [
    ...(unitTitle ? [`Unit: ${unitTitle}`] : []),
    ...(outcomes.length ? ["Unit outcomes:", ...outcomes.map((text) => `- ${text}`)] : []),
    ...(objectives.length ? ["Objectives:", ...objectives.map((text) => `- ${text}`)] : []),
    ...(keyTerms.length ? [`Key terms: ${keyTerms.join(", ")}`] : []),
    ...(inScope ? [`Covers: ${inScope}`] : []),
    ...(outOfScope ? [`Leaves out: ${outOfScope}`] : []),
  ];
}
