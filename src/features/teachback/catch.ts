import { z } from "zod";
import { chatJSON } from "@/features/ai";
import { contentIdOf } from "@/features/skill-map";
import { HttpError } from "@/shared/http";
import { getDoc, putDoc } from "@/shared/store";
import { startOnce, waitForOnce } from "@/shared/store/once";
import type { CatchRecord, SkillMap, SkillNode } from "@/shared/types";
import { audienceKey } from "@/shared/audience";
import { CATCH_WRITER_NOTE, forAudience } from "./audience";
import { numberedList } from "./grading";
import { syllabusSuffix } from "./skillLines";

/**
 * "Catch the mistake": the AI explains a topic with one or two planted mistakes, and the
 * learner taps them. Which sentences are wrong stays on the server until the round is submitted.
 */
export type CatchChallenge = {
  sentences: string[];
  /** 1-based sentence number, the checkpoint (0-based) it breaks, and what is wrong with it. */
  mistakes: { sentence: number; checkpoint: number; why: string }[];
  createdAt: string;
};

/** What the browser gets before submitting: the sentences and how many are wrong, nothing else. */
export type CatchView = { sentences: string[]; mistakeCount: number };

/** A tapped sentence. Nothing to write: the owner found typing a correction for every tap too much (Nov 9). */
export type CatchPick = { sentence: number };

export const WRITER_SYSTEM = `You write a short, confident explanation of a topic for a curious learner, with mistakes planted in it on purpose. The learner's job is to find them.

- Write 5 to 8 short sentences in plain words. Each sentence states one idea.
- Plant exactly the number of mistakes you are asked for. Each mistake is one sentence that states something clearly false about one of the numbered facts, in a way that sounds believable. Use a different fact for each mistake.
- Every other sentence must be fully correct.
- Never hint at a mistake: no "some say", no hedging, no odd emphasis.
- For each mistake, give its sentence number, the fact number it breaks, and "why": one sentence saying what is wrong and what is true.`;

/** Two mistakes when there are enough checkpoints to break, so bigger topics are harder. */
export function mistakesFor(node: SkillNode): number {
  return node.checkpoints.length >= 4 ? 2 : 1;
}

function writerSchema(wanted: number, checkpoints: number) {
  return z
    .object({
      sentences: z.array(z.string().trim().min(1)).min(5).max(8),
      mistakes: z.array(z.object({ sentence: z.number().int(), fact: z.number().int(), why: z.string().trim().min(1) })),
    })
    .superRefine((reply, context) => {
      const sentences = new Set(reply.mistakes.map((mistake) => mistake.sentence));
      const facts = new Set(reply.mistakes.map((mistake) => mistake.fact));
      const inRange = reply.mistakes.every(
        (mistake) =>
          mistake.sentence >= 1 && mistake.sentence <= reply.sentences.length && mistake.fact >= 1 && mistake.fact <= checkpoints,
      );
      if (reply.mistakes.length !== wanted || sentences.size !== wanted || facts.size !== wanted || !inRange) {
        context.addIssue({
          code: "custom",
          message: `Plant exactly ${wanted} mistake(s), each in a different sentence and on a different fact, with numbers in range.`,
        });
      }
    });
}

/** A request that finds someone else writing the round waits this long for it. */
export const CATCH_WAIT_MS = 40_000;

/** The store key of a topic's round: one per catalog course (or posting map) and audience. */
export function catchKey(map: Pick<SkillMap, "id" | "courseId" | "audience">, nodeId: string): string {
  // A round for an audience is kept apart, so an adult round written earlier is never shown to a child.
  return `catch/${contentIdOf(map)}/${nodeId}${map.audience ? `/${audienceKey(map.audience)}` : ""}`;
}

/**
 * Loads this topic's round, or writes one with the AI and keeps it. It is written once per topic
 * of a course (under `startOnce`) and shared by every learner of it, so a started course never
 * waits on the AI twice. A request that finds another writer waits for its round (up to 40 s).
 */
export async function loadCatchChallenge(map: SkillMap, node: SkillNode): Promise<CatchChallenge> {
  const key = catchKey(map, node.id);
  const saved = await getDoc<CatchChallenge>(key);
  if (saved) return saved;

  const started = await startOnce<CatchChallenge>(key, async () => {
    const wanted = mistakesFor(node);
    const reply = await chatJSON({
      profile: "write",
      label: "teachback-catch-write",
      system: forAudience(WRITER_SYSTEM, map.audience, CATCH_WRITER_NOTE),
      prompt: `Topic: ${node.title}${syllabusSuffix(map, node)}\n\nFacts:\n${numberedList(node.checkpoints)}\n\nPlant ${wanted} mistake${wanted === 1 ? "" : "s"}.`,
      schema: writerSchema(wanted, node.checkpoints.length),
      maxTokens: 6_000,
      totalMs: 40_000,
    });
    return {
      sentences: reply.sentences,
      mistakes: reply.mistakes.map((mistake) => ({ sentence: mistake.sentence, checkpoint: mistake.fact - 1, why: mistake.why })),
      createdAt: new Date().toISOString(),
    };
  });
  if (typeof started === "object") return started.work;
  const value = (await getDoc<CatchChallenge>(key)) ?? (await waitForOnce<CatchChallenge>(key, { timeoutMs: CATCH_WAIT_MS }));
  if (!value) throw new HttpError("Writing this round took too long this time. Please try again in a moment.", 503);
  return value;
}

export function toCatchView(challenge: CatchChallenge): CatchView {
  return { sentences: challenge.sentences, mistakeCount: challenge.mistakes.length };
}

/**
 * Once a learner submits a round, they have seen where the mistakes were, so they can't
 * play it again. The key holds their id, so "Delete my data" can find it.
 */
export function revealedKey(mapId: string, ownerId: string, nodeId: string): string {
  return `catch-revealed/${mapId}/${ownerId}/${nodeId}`;
}

export async function hasRevealed(mapId: string, ownerId: string, nodeId: string): Promise<boolean> {
  return (await getDoc(revealedKey(mapId, ownerId, nodeId))) !== null;
}

export async function markRevealed(mapId: string, ownerId: string, nodeId: string): Promise<void> {
  await putDoc(revealedKey(mapId, ownerId, nodeId), { revealedAt: new Date().toISOString() });
}

/** Code alone decides which taps were right: a tapped sentence is caught if a mistake was planted there. */
export function checkCatch(challenge: CatchChallenge, picks: CatchPick[]): CatchRecord {
  const planted = new Set(challenge.mistakes.map((mistake) => mistake.sentence));
  return {
    sentences: challenge.sentences,
    planted: challenge.mistakes.map(({ sentence, why }) => ({ sentence, why })),
    picks: picks.map((pick) => ({ sentence: pick.sentence, fixed: planted.has(pick.sentence) })),
  };
}

/** What the learner marked, as text: each tapped sentence. A caught mistake's quote comes from here. */
export function catchTranscript(challenge: CatchChallenge, picks: CatchPick[]): string {
  return picks.map((pick) => `Sentence ${pick.sentence}: ${challenge.sentences[pick.sentence - 1]}`).join("\n");
}
