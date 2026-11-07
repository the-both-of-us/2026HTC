import { z } from "zod";
import { HttpError } from "@/shared/http";
import { checkServerValue, signServerValue } from "@/shared/identity";
import { listDocs, putDoc } from "@/shared/store";
import { answerText, buildExercises, checkChoice, checkNumber, type Figure } from "./exercises";
import { isReportOld } from "./live";
import type { GridReading, GridSnapshot } from "./types";

/**
 * A "Read the Grid" question someone answered correctly. Code checked the answer on the server,
 * against figures the server itself handed out. No AI is involved.
 */
export type GridSolve = {
  exerciseId: string;
  title: string;
  skill: string;
  /** AESO's report time, and the same in AESO's words. */
  asOf: string;
  asOfLabel: string;
  answer: string;
  figures: Figure[];
  working: string[];
  /** AESO's report was over 15 minutes old when it was solved, so it is told as old figures. */
  stale: boolean;
  solvedAt: string;
};

const SEAL_PURPOSE = "grid-reading";

function sealedText(snapshot: unknown, fetchedAt: string): string {
  return JSON.stringify({ fetchedAt, snapshot });
}

/** Adds the server's signature, so an answer sent back with these figures can be trusted. */
export function sealReading(reading: GridReading): GridReading {
  if (reading.status === "unavailable") return reading;
  const seal = signServerValue(SEAL_PURPOSE, sealedText(reading.snapshot, reading.fetchedAt));
  return seal ? { ...reading, seal } : reading;
}

export const solveBody = z.object({
  exerciseId: z.string().max(40),
  answer: z.string().max(40),
  reading: z.object({ fetchedAt: z.string().max(40), seal: z.string().max(100), snapshot: z.unknown() }),
});

export type SolveInput = z.infer<typeof solveBody>;

/**
 * Checks the answer again on the server and, only if it is right, saves it for this user. One
 * document per user and question, so the newest correct answer replaces the last one.
 */
export async function recordSolve(userId: string, input: SolveInput, now: number = Date.now()): Promise<GridSolve> {
  const { reading } = input;
  if (!checkServerValue(SEAL_PURPOSE, sealedText(reading.snapshot, reading.fetchedAt), reading.seal)) {
    throw new HttpError("We couldn't confirm these figures came from AESO through us. Use the newest numbers and try again.", 400);
  }
  // The seal shows this is exactly what the server sent, so it has the snapshot's shape.
  const snapshot = reading.snapshot as GridSnapshot;
  const exercise = buildExercises(snapshot).find((item) => item.id === input.exerciseId);
  if (!exercise) throw new HttpError("That question isn't part of this reading. Use the newest numbers and try again.", 404);

  const result = exercise.kind === "number" ? checkNumber(exercise, input.answer) : checkChoice(exercise, input.answer);
  if (result.outcome !== "correct") {
    throw new HttpError("That answer doesn't match AESO's figures, so it wasn't saved.", 422);
  }

  const solve: GridSolve = {
    exerciseId: exercise.id,
    title: exercise.title,
    skill: exercise.skill,
    asOf: snapshot.asOf,
    asOfLabel: snapshot.asOfLabel,
    answer: answerText(exercise),
    figures: exercise.figures,
    working: exercise.working,
    stale: isReportOld(snapshot, now),
    solvedAt: new Date(now).toISOString(),
  };
  await putDoc(`grid-solves/${userId}/${exercise.id}`, solve);
  return solve;
}

/** Everything this user has solved, oldest first. */
export async function listGridSolves(userId: string): Promise<GridSolve[]> {
  const solves = await listDocs<GridSolve>(`grid-solves/${userId}/`);
  return solves.sort((a, b) => a.solvedAt.localeCompare(b.solvedAt));
}
