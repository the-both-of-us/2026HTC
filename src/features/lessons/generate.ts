import { modelId, modelLabel, streamLines } from "@/features/ai";
import { HttpError } from "@/shared/http";
import type { OnceContext } from "@/shared/store/once";
import type { CourseSyllabus, SkillMap, SkillNode } from "@/shared/types";
import { buildLessonPrompt, isDegree, lessonLineSchema, lessonLinesSystemPrompt, wantsPractice, type RawLesson } from "./prompt";
import type { LessonLine, WrittenBy } from "./types";
import { assembleLesson, cleanLine, lessonProblem, lineProblem, PART_LIMITS, splitIdeaParagraphs } from "./validate";

/** A lesson call: the write profile, 12k tokens and 60 s (design2 section A). */
export const LESSON_MAX_TOKENS = 12_000;
export const LESSON_TOTAL_MS = 60_000;
/** The one rewrite runs only when at least this much of the deadline is left. */
export const MIN_REWRITE_MS = 25_000;

const TOO_SLOW = "Writing this lesson did not work this time. Please try again in a moment.";

/** What the lesson prompt needs: the course's title, audience and syllabus (for the depth and the node's unit). */
export type LessonCourse = Pick<SkillMap, "title"> & { audience?: string; syllabus?: CourseSyllabus };

export type WrittenLesson = { raw: RawLesson; writtenBy: WrittenBy };

/**
 * One streamed attempt. Each valid line is cleaned (an idea line holding several paragraphs becomes
 * one line per paragraph) and checked on its own: a line that copies a
 * checkpoint or has an empty field is rejected and never emitted; a line past its part's limit
 * (or a practice line where none is wanted) is dropped quietly. The rest are emitted in order.
 */
async function attempt(
  course: LessonCourse,
  node: SkillNode,
  context: OnceContext<LessonLine>,
  totalMs: number,
  feedback: string,
): Promise<{ raw: RawLesson | null; problems: string[] }> {
  const depth = isDegree(course) ? "degree" : undefined;
  const withPractice = wantsPractice(course.audience, depth);
  const kept: LessonLine[] = [];
  const problems: string[] = [];
  const counts: Record<LessonLine["part"], number> = { idea: 0, example: 0, mistake: 0, check: 0, practice: 0 };

  const result = await streamLines({
    profile: "write",
    label: "lesson",
    system: lessonLinesSystemPrompt(course.audience, depth),
    prompt: `${buildLessonPrompt(course, node)}${feedback}`,
    line: lessonLineSchema,
    maxTokens: LESSON_MAX_TOKENS,
    totalMs,
    onLine: async (raw) => {
      // Haiku often writes all the idea paragraphs in one line, split by a blank line: count them as paragraphs.
      for (const line of splitIdeaParagraphs(cleanLine(raw as LessonLine, course.audience))) {
        if (line.part === "practice" && !withPractice) continue;
        if (counts[line.part] >= PART_LIMITS[line.part]) continue;
        const problem = lineProblem(line, node.checkpoints);
        if (problem) {
          problems.push(problem);
          continue;
        }
        counts[line.part] += 1;
        kept.push(line);
        await context.emit(line);
      }
    },
  });
  await context.flush();

  for (const rejected of result.rejected) problems.push(`line ${rejected.index + 1} was not valid: ${rejected.reason}`);
  if (result.truncated) problems.push("the reply was cut off before the end.");
  const raw = assembleLesson(kept, withPractice);
  const problem = raw ? lessonProblem(raw, node.checkpoints, course.audience, depth) : "there was no example line.";
  if (problem) problems.push(problem);
  return { raw, problems };
}

/**
 * Writes one lesson as JSON lines, emitting each part as it arrives (the Read tab shows them).
 * If any line was rejected or the assembled lesson has a problem, one rewrite runs: `restart()`
 * (attempt 2, the viewer swaps in the new parts) with the problems appended. The rewrite counts
 * when the lesson itself passes. Otherwise a 503 sentence. Never sends the source text or owner.
 */
export async function writeLesson(
  course: LessonCourse,
  node: SkillNode,
  context: OnceContext<LessonLine>,
  deadline: number,
): Promise<WrittenLesson> {
  const startedAt = Date.now();
  const first = await attempt(course, node, context, Math.min(LESSON_TOTAL_MS, deadline - Date.now()), "");
  const writtenBy = () => ({ model: modelLabel(modelId()), ms: Date.now() - startedAt });
  if (first.raw && first.problems.length === 0) return { raw: first.raw, writtenBy: writtenBy() };

  console.warn(`[lessons] first attempt rejected, rewriting: ${first.problems.join(" ").slice(0, 300)}`);
  const left = deadline - Date.now();
  if (left < MIN_REWRITE_MS) throw new HttpError(TOO_SLOW, 503);
  await context.restart();
  const feedback = `\n\nYour previous lesson was rejected because ${first.problems.join(" ")}\nWrite the whole lesson again, fixing that.`;
  const second = await attempt(course, node, context, Math.min(LESSON_TOTAL_MS, left), feedback);
  const depth = isDegree(course) ? "degree" : undefined;
  if (second.raw && lessonProblem(second.raw, node.checkpoints, course.audience, depth) === null) {
    return { raw: second.raw, writtenBy: writtenBy() };
  }
  console.warn(`[lessons] the rewrite failed too: ${second.problems.join(" ")}`);
  throw new HttpError(TOO_SLOW, 503);
}

/** A context that keeps nothing, for a lesson written outside the store (scripts/cache-lessons.ts). */
const NO_STORE: OnceContext<LessonLine> = {
  attempt: 1,
  emit: async () => undefined,
  flush: async () => undefined,
  restart: async () => undefined,
  heartbeat: async () => undefined,
};

/** One lesson with no store and no claim: for scripts that save sample lessons as fixtures. */
export async function askModelForLesson(course: LessonCourse, node: SkillNode): Promise<WrittenLesson> {
  return writeLesson(course, node, NO_STORE, Date.now() + 2 * LESSON_TOTAL_MS);
}
