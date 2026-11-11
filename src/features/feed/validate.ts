import { countWords } from "@/shared/text";
import type { RawCards } from "./prompt";
import type { PoolCard } from "./types";

/** Fewer good cards than this and the whole reply is asked for again. */
export const MIN_GOOD_CARDS = 4;
const MAX_CARDS = 12;
const URL_PATTERN = /https?:\/\/|www\.|\.(com|org|net|io)\b/i;

const sentenceCount = (text: string) => text.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim() !== "").length;

/** Titles compared without case, punctuation or spacing. */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** What is wrong with one card, or null. */
export function cardProblem(card: RawCards["cards"][number]): string | null {
  const titleWords = countWords(card.title);
  if (titleWords < 2 || titleWords > 9) return `the title "${card.title}" should be 3 to 7 words.`;
  const bodyWords = countWords(card.body);
  if (bodyWords < 12 || bodyWords > 110) return `the body of "${card.title}" should be 2 to 4 short sentences.`;
  if (sentenceCount(card.body) > 6) return `the body of "${card.title}" has too many sentences. Use 2 to 4.`;
  const subtopicWords = countWords(card.subtopic);
  if (subtopicWords < 1 || subtopicWords > 8 || card.subtopic.length > 60) return `the subtopic of "${card.title}" should be 2 to 6 words.`;
  if (URL_PATTERN.test(`${card.title} ${card.body} ${card.subtopic}`)) return `"${card.title}" has a link. Never include links.`;
  return null;
}

/** The first problem with the reply as a whole, for the model's one retry, or null when enough new cards are good. */
export function cardsProblem(reply: RawCards, usedTitles: string[] = []): string | null {
  const used = new Set(usedTitles.map(titleKey));
  const problems = reply.cards.map((card) => cardProblem(card) ?? (used.has(titleKey(card.title)) ? `"${card.title}" is already used.` : null));
  const good = problems.filter((problem) => problem === null).length;
  if (good >= MIN_GOOD_CARDS) return null;
  return problems.find((problem) => problem !== null) ?? `write ${MIN_GOOD_CARDS} or more cards.`;
}

/**
 * The good cards, trimmed and numbered from `startAt`, in the order the model wrote them. Bad
 * ones and titles already in the pool (or repeated in the reply) are dropped quietly.
 */
export function toPoolCards(reply: RawCards, slug: string, { usedTitles = [], startAt = 0, now = new Date() }: { usedTitles?: string[]; startAt?: number; now?: Date } = {}): PoolCard[] {
  const seen = new Set(usedTitles.map(titleKey));
  return reply.cards
    .filter((card) => cardProblem(card) === null)
    .filter((card) => {
      const key = titleKey(card.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CARDS)
    .map((card, index) => ({
      id: `${slug}.c${startAt + index}`,
      title: card.title.trim().replace(/[.:]+$/, ""),
      body: card.body.trim().replace(/\s+/g, " "),
      subtopic: card.subtopic.trim().replace(/[.:]+$/, ""),
      createdAt: now.toISOString(),
    }));
}

const ITEM_ID = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(c\d{1,5}|v[A-Za-z0-9_-]{6,20})$/;

/** The interest slug of a card or Short id, or null when it is not one. */
export function slugOfItem(itemId: string): string | null {
  if (itemId.length > 90) return null;
  const match = ITEM_ID.exec(itemId);
  return match && match[1].length <= 60 ? match[1] : null;
}
