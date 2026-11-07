import { randomUUID } from "node:crypto";
import type { Citation, SkillNode } from "@/shared/types";
import type { Flashcard } from "./types";
import { FlashcardsError } from "./errors";
import type { RawDeck } from "./prompt";

/**
 * Hard limits. They sit a little above what the prompt asks for, so a card that
 * runs a few words long is kept rather than costing the learner a whole new call.
 */
export const MAX_FRONT_CHARACTERS = 200;
export const MAX_BACK_CHARACTERS = 500;
export const MIN_CARDS = 4;
export const MAX_CARDS = 10;

/** Collapses runs of whitespace, so "  a \n b " and "a b" are the same card. */
function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Two fronts that differ only in case, spacing or trailing punctuation are the same question.
 * Symbols inside the question stay, so "C++" and "C#", or "1.5" and "15", are different questions.
 */
export function sameQuestionKey(front: string): string {
  return front.toLowerCase().replace(/\s+/g, " ").trim().replace(/[\s.?!:;,]+$/u, "");
}

/** The model never writes citations. A card carries the node's quote only when code verified it. */
export function citationFor(node: SkillNode): Citation | null {
  return node.citation?.verified ? { ...node.citation } : null;
}

/**
 * Turns the model's reply into cards we can trust: trimmed, deduplicated, within
 * limits, with ids, map and node ids and citations all set by code. Throws if too few survive.
 */
export function validateDeck(raw: RawDeck, mapId: string, node: SkillNode): Flashcard[] {
  const citation = citationFor(node);
  const seen = new Set<string>();
  const cards: Flashcard[] = [];

  for (const item of raw.cards) {
    const front = tidy(item.front);
    const back = tidy(item.back);
    if (!front || !back) continue;
    if (front.length > MAX_FRONT_CHARACTERS || back.length > MAX_BACK_CHARACTERS) continue;

    const key = sameQuestionKey(front);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    cards.push({ id: randomUUID(), mapId, nodeId: node.id, front, back, citation: citation && { ...citation } });
    if (cards.length === MAX_CARDS) break;
  }

  if (cards.length < MIN_CARDS) {
    throw new FlashcardsError("The flashcards did not come out right this time. Please try again.", 502);
  }
  return cards;
}
