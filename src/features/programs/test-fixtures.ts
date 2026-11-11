/**
 * Tests only: model output for the catalog flow (program frames and syllabi as JSON Lines), a
 * fake `streamLines` that replays them, and unit nodes. Nothing in the app
 * imports this file.
 */
import type { StreamLinesOptions, StreamLinesResult } from "@/features/ai";
import { putDoc } from "@/shared/store";
import { DEGREE_FRAME, type SkillNode } from "@/shared/types";

export type ScriptedLines = Record<string, unknown>[];

/** A short psychology plan: head plus 5 course lines. */
export function psychologyPlanLines(): ScriptedLines {
  return [
    { kind: "head", title: "Psychology", summary: "Understand how people think, feel and act." },
    { kind: "course", slug: "intro-psychology", title: "Introduction to psychology", summary: "Know the field and its methods.", requires: [] },
    { kind: "course", slug: "research-methods", title: "Research methods", summary: "Read and design a study.", requires: ["intro-psychology"] },
    { kind: "course", slug: "biological-psychology", title: "Biological psychology", summary: "Link brain and behaviour.", requires: ["intro-psychology"] },
    { kind: "course", slug: "social-psychology", title: "Social psychology", summary: "Explain how others shape us.", requires: ["research-methods"] },
    { kind: "course", slug: "cognitive-psychology", title: "Cognitive psychology", summary: "Explain memory and attention.", requires: ["research-methods"] },
  ];
}

const AREAS = ["Foundations", "Methods", "Biological", "Social", "Cognitive"];

/** A 40-course degree frame: 4 years x 2 terms x 5 courses, levels by year. */
export function degreeFrameLines(subject = "Psychology"): ScriptedLines {
  const lines: ScriptedLines = [{ kind: "head", title: subject, summary: `A four-year path through ${subject.toLowerCase()}.` }];
  const words = ["Perception", "Memory", "Emotion", "Learning", "Language", "Motivation", "Personality", "Development"];
  for (let year = 1; year <= DEGREE_FRAME.years; year++) {
    for (let term = 1; term <= 2; term++) {
      for (let k = 0; k < DEGREE_FRAME.coursesPerTerm; k++) {
        const n = (year - 1) * 10 + (term - 1) * 5 + k;
        const title = n === 0 ? `Introduction to ${subject.toLowerCase()}` : `${words[n % words.length]} ${AREAS[k]} ${["I", "II", "III", "IV", "V"][year - 1]} t${term}`;
        lines.push({
          kind: "course",
          slug: `course-${n + 1}`,
          title,
          summary: `Course ${n + 1}.`,
          requires: n >= 5 ? [`course-${n - 4}`] : [],
          year,
          term,
          level: year * 100,
          area: AREAS[k],
        });
      }
    }
  }
  return lines;
}

/** A full 8-unit syllabus as lines, with topic ids prefixed so courses never share one. */
export function syllabusLines(prefix: string, units = 8): ScriptedLines {
  const lines: ScriptedLines = [
    {
      kind: "head",
      outcomes: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, text: `Explain part ${n} of ${prefix}.` })),
    },
  ];
  for (let u = 1; u <= units; u++) {
    lines.push({
      kind: "unit",
      id: `u${u}`,
      title: `Unit ${u} of ${prefix}`,
      outcomeIds: [`o${((u - 1) % 4) + 1}`],
      topics: [1, 2, 3, 4, 5].map((t) => ({
        id: `${prefix}-u${u}-t${t}`,
        title: `${prefix} ${["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"][u - 1]} ${["one", "two", "three", "four", "five"][t - 1]}`,
        objectives: ["Explain it.", "Use it."],
        keyTerms: ["term a", "term b", "term c"],
        inScope: "What it covers.",
        outOfScope: "What it leaves out.",
        buildsOn: t > 1 ? [`${prefix}-u${u}-t${t - 1}`] : [],
      })),
    });
  }
  return lines;
}

/**
 * A fake `streamLines`: replays `script(options)` line by line through the real validator and
 * `onLine`, as the AI layer would. Unknown labels throw, like an unavailable model.
 */
export function fakeStreamLines(script: (options: StreamLinesOptions<unknown>) => ScriptedLines | null) {
  return async <L>(options: StreamLinesOptions<L>): Promise<StreamLinesResult<L>> => {
    const raw = script(options as StreamLinesOptions<unknown>);
    if (!raw) throw Object.assign(new Error("The AI is unavailable right now."), { name: "AiUnavailableError" });
    const lines: L[] = [];
    const rejected: { index: number; reason: string }[] = [];
    for (const [index, value] of raw.entries()) {
      const parsed = options.line.safeParse(value);
      if (!parsed.success) {
        rejected.push({ index, reason: "invalid" });
        continue;
      }
      lines.push(parsed.data);
      await options.onLine(parsed.data, index);
    }
    return { lines, rejected, truncated: false };
  };
}

/** Nodes for a unit, as the canonical unit cache holds them (what ensureUnitNodes would write). */
export function unitNodes(topicIds: string[]): SkillNode[] {
  return topicIds.map((id, index) => ({
    id,
    title: id,
    why: "Needed.",
    prerequisites: index > 0 ? [topicIds[index - 1]] : [],
    fromSource: false,
    citation: null,
    checkpoints: ["a", "b", "c"],
  }));
}

/** Writes a unit cache entry the way WP-C's ensureUnitNodes does. */
export async function writeUnitCache(contentId: string, unitId: string, nodes: SkillNode[]): Promise<void> {
  await putDoc(`unit-nodes/${contentId}/${unitId}`, { rootMapId: contentId, unitId, nodes, builtAt: new Date().toISOString() });
}
