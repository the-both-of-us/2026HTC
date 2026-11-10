import { z } from "zod";
import { chatJSON, type Tier } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { CatchRecord, SkillMap, SkillNode } from "@/shared/types";
import { audienceKey } from "@/shared/audience";
import { CATCH_CHECKER_NOTE, CATCH_WRITER_NOTE, forAudience } from "./audience";
import { numberedList } from "./grading";
import { countWords, LEARNER_TEXT_RULE, wrapLearnerText } from "./learnerText";

/**
 * "Catch the mistake": the AI explains a topic with one or two planted mistakes, and the
 * learner finds and fixes them. Which sentences are wrong stays on the server until the
 * round is submitted.
 */
export type CatchChallenge = {
  sentences: string[];
  /** 1-based sentence number, the checkpoint (0-based) it breaks, and what is wrong with it. */
  mistakes: { sentence: number; checkpoint: number; why: string }[];
  createdAt: string;
};

/** What the browser gets before submitting: the sentences and how many are wrong, nothing else. */
export type CatchView = { sentences: string[]; mistakeCount: number };

export type CatchPick = { sentence: number; correction: string };

/** A correction needs enough words to say what is true. It also becomes a quote on the evidence page. */
export const MIN_CORRECTION_WORDS = 3;

export const WRITER_SYSTEM = `You write a short, confident explanation of a topic for a curious learner, with mistakes planted in it on purpose. The learner's job is to find them.

- Write 5 to 8 short sentences in plain words. Each sentence states one idea.
- Plant exactly the number of mistakes you are asked for. Each mistake is one sentence that states something clearly false about one of the numbered facts, in a way that sounds believable. Use a different fact for each mistake.
- Every other sentence must be fully correct.
- Never hint at a mistake: no "some say", no hedging, no odd emphasis.
- For each mistake, give its sentence number, the fact number it breaks, and "why": one sentence saying what is wrong and what is true.`;

export const CHECKER_SYSTEM = `A learner found planted mistakes in an explanation and wrote a correction for each. For each numbered item you get the wrong sentence, what was really wrong with it, and the learner's correction.

Return the numbers of the corrections that fix the mistake. Be generous: a correction counts if it says what is true, says what is false about the sentence, or states a true point that contradicts the false claim, even without naming its exact words. Plain, short or misspelled wording is fine. A correction only fails if it just says "this is wrong", repeats the sentence, is itself false, or is about something the sentence never claimed.

${LEARNER_TEXT_RULE}`;

const checkerReplySchema = z.object({ fixed: z.array(z.number().int()) });

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

/**
 * Loads this topic's round, or writes one with the AI and keeps it. It is written once per
 * topic and shared by every copy of a course, so a started sample course never waits on the AI.
 */
export async function loadCatchChallenge(map: SkillMap, node: SkillNode): Promise<CatchChallenge> {
  // A round for an audience is kept apart, so an adult round written earlier is never shown to a child.
  const key = `catch/${map.forkedFrom ?? map.id}/${node.id}${map.audience ? `/${audienceKey(map.audience)}` : ""}`;
  const saved = await getDoc<CatchChallenge>(key);
  if (saved) return saved;

  const wanted = mistakesFor(node);
  const reply = await chatJSON({
    label: "teachback-catch-write",
    system: forAudience(WRITER_SYSTEM, map.audience, CATCH_WRITER_NOTE),
    prompt: `Topic: ${node.title}\n\nFacts:\n${numberedList(node.checkpoints)}\n\nPlant ${wanted} mistake${wanted === 1 ? "" : "s"}.`,
    schema: writerSchema(wanted, node.checkpoints.length),
    timeoutMs: 20_000,
  });

  const challenge: CatchChallenge = {
    sentences: reply.sentences,
    mistakes: reply.mistakes.map((mistake) => ({ sentence: mistake.sentence, checkpoint: mistake.fact - 1, why: mistake.why })),
    createdAt: new Date().toISOString(),
  };
  await putDoc(key, challenge);
  return challenge;
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

/**
 * Code decides which taps were right: the tapped sentence numbers must match the planted ones.
 * Then one AI call checks only the corrections on real mistakes. A correction under three words
 * can't fix anything, so it never reaches the AI.
 */
export async function checkCatch(
  node: SkillNode,
  challenge: CatchChallenge,
  picks: CatchPick[],
  audience = "",
  tier?: Tier,
): Promise<CatchRecord> {
  const planted = new Map(challenge.mistakes.map((mistake) => [mistake.sentence, mistake]));
  const toCheck = picks.filter(
    (pick) => planted.has(pick.sentence) && countWords(pick.correction) >= MIN_CORRECTION_WORDS,
  );

  let fixedSentences = new Set<number>();
  if (toCheck.length > 0) {
    const items = toCheck.map((pick, index) => {
      const mistake = planted.get(pick.sentence)!;
      return `${index + 1}. Wrong sentence: ${challenge.sentences[pick.sentence - 1]}\nWhat was wrong: ${mistake.why}\nCorrection: ${wrapLearnerText(pick.correction)}`;
    });
    const reply = await chatJSON({
      label: "teachback-catch-check",
      system: forAudience(CHECKER_SYSTEM, audience, CATCH_CHECKER_NOTE),
      prompt: `Topic: ${node.title}\n\n${items.join("\n\n")}`,
      schema: checkerReplySchema,
      timeoutMs: 15_000,
      tier,
    });
    fixedSentences = new Set(toCheck.filter((_, index) => reply.fixed.includes(index + 1)).map((pick) => pick.sentence));
  }

  return {
    sentences: challenge.sentences,
    planted: challenge.mistakes.map(({ sentence, why }) => ({ sentence, why })),
    picks: picks.map((pick) => ({ ...pick, fixed: fixedSentences.has(pick.sentence) })),
  };
}

/** The learner's own words for a catch round, which is what the evidence page quotes from. */
export function catchTranscript(picks: CatchPick[]): string {
  return picks.map((pick) => `Sentence ${pick.sentence}: ${pick.correction}`).join("\n");
}
