import { PROFILES, streamLines } from "@/features/ai";
import { HttpError } from "@/shared/http";
import type { CourseSyllabus, SyllabusOutcome, SyllabusUnit } from "@/shared/types";
import { SyllabusBuilder, syllabusLine, syllabusUnitLine, type SyllabusLine } from "./lines";
import { buildRepairPrompt, buildSyllabusPrompt, SYLLABUS_LINES_SYSTEM } from "./prompt";
import type { SyllabusContext } from "./types";

/** A repair is only started with at least this much time left before the deadline. */
export const MIN_REPAIR_MS = 30_000;
/** Kept free at the end of the deadline for saving the result. */
const SAVE_MARGIN_MS = 3_000;

export const SYLLABUS_FAILED = "We could not plan a full syllabus for this course just now. Please try again.";

/** What the caller does with each committed piece: save it as a part and show it at once. */
export type SyllabusHooks = {
  /** Epoch ms by which the build must be done. */
  deadline: number;
  onHead(outcomes: SyllabusOutcome[]): Promise<void>;
  /** Called once per committed unit, in order. `soFar` is the planning syllabus including it. */
  onUnit(unit: SyllabusUnit, soFar: CourseSyllabus): Promise<void>;
  /** An invalid head starts over once: the caller clears the parts shown so far. */
  onRestart(): Promise<void>;
};

class InvalidHead extends Error {}

const timeLeft = (deadline: number) => deadline - Date.now() - SAVE_MARGIN_MS;

/**
 * Writes one course's syllabus as JSON Lines on the plan profile (one call), committing each unit
 * as it arrives. An invalid head (or a unit before the head) starts over once. Missing units then
 * get one repair call (lines again) that lists the committed units and asks for the missing ids
 * only, if time allows. With at least 6 units the syllabus is accepted. Saves nothing.
 * Throws AiUnavailableError / AiRefusedError from the AI layer, or a 422 HttpError when too few
 * units came back.
 */
/**
 * Measured Nov 11 2026 (real Haiku): the degree's "Introduction to psychology" syllabus, with the
 * 40-course frame in its prompt, thought for over 70 s at effort high and never wrote a line, so
 * the course could not start. Medium thinks about a third less (design2: first text 13 s vs 21 s
 * on a standalone syllabus) and the outline still comes from the plan: units, topics, objectives.
 */
export const SYLLABUS_EFFORT = "medium" as const;

export async function streamSyllabus(ctx: SyllabusContext, hooks: SyllabusHooks): Promise<CourseSyllabus> {
  let builder = new SyllabusBuilder(ctx);

  for (let round = 1; ; round++) {
    builder = new SyllabusBuilder(ctx);
    const current = builder;
    try {
      await streamLines<SyllabusLine>({
        profile: "plan",
        label: "syllabus",
        system: SYLLABUS_LINES_SYSTEM,
        prompt: buildSyllabusPrompt(ctx),
        line: syllabusLine,
        totalMs: Math.min(PROFILES.plan.totalMs, timeLeft(hooks.deadline)),
        effort: SYLLABUS_EFFORT,
        onLine: async (line) => {
          if (line.kind === "head") {
            if (current.hasHead) return;
            const head = current.head(line);
            if (!head.ok) throw new InvalidHead(head.problem);
            await hooks.onHead(head.outcomes);
            return;
          }
          if (!current.hasHead) throw new InvalidHead("A unit came before the head.");
          const result = current.unit(line);
          if (result.ok) await hooks.onUnit(result.unit, current.current());
          else console.warn(`[syllabus] ${ctx.course.slug}: unit rejected: ${result.problem}`);
        },
      });
      if (!current.hasHead) throw new InvalidHead("The reply had no head line.");
      break;
    } catch (error) {
      if (!(error instanceof InvalidHead)) {
        // A stream cut off after some units keeps them: the repair asks for the rest.
        const refused = error instanceof Error && error.name === "AiRefusedError";
        if (refused || !current.hasHead || current.units.length === 0) throw error;
        console.warn(`[syllabus] ${ctx.course.slug}: stream stopped after ${current.units.length} units: ${error instanceof Error ? error.name : "unknown"}`);
        break;
      }
      console.warn(`[syllabus] ${ctx.course.slug}: ${error.message}`);
      if (round >= 2 || timeLeft(hooks.deadline) < MIN_REPAIR_MS) throw new HttpError(SYLLABUS_FAILED, 422);
      await hooks.onRestart();
    }
  }

  const missing = builder.missing();
  if (missing.length > 0 && timeLeft(hooks.deadline) >= MIN_REPAIR_MS) {
    const current = builder;
    try {
      await streamLines({
        profile: "plan",
        label: "syllabus-repair",
        effort: SYLLABUS_EFFORT,
        system: SYLLABUS_LINES_SYSTEM,
        prompt: buildRepairPrompt(
          ctx,
          current.units,
          (current.outcomes ?? []).map((o) => `${o.id}: ${o.text}`),
          missing,
        ),
        line: syllabusUnitLine,
        totalMs: Math.min(PROFILES.plan.totalMs, timeLeft(hooks.deadline)),
        onLine: async (line) => {
          const result = current.unit(line);
          if (result.ok) await hooks.onUnit(result.unit, current.current());
          else console.warn(`[syllabus] ${ctx.course.slug}: repair unit rejected: ${result.problem}`);
        },
      });
    } catch (error) {
      // The units committed so far stand; the count check below decides.
      console.warn(`[syllabus] ${ctx.course.slug}: repair failed: ${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  const syllabus = builder.finish();
  if (!syllabus) {
    console.warn(`[syllabus] ${ctx.course.slug}: only ${builder.units.length} units`);
    throw new HttpError(SYLLABUS_FAILED, 422);
  }
  return syllabus;
}
