import { normalizeForMatch } from "@/shared/quote";
import type { SkillMap } from "@/shared/types";
import type { RawCards } from "./prompt";
import type { Topiclet } from "./types";

/** Fewer good cards than this and the whole reply is asked for again. */
export const MIN_GOOD_CARDS = 4;
const MAX_CARDS = 14;
const URL_PATTERN = /https?:\/\/|www\.|\.(com|org|net|io)\b/i;

/** A run of this many checkpoint words, in order, counts as copying it (the same rule lessons use). */
const COPIED_RUN = 8;

function wordsOf(text: string): string[] {
  return normalizeForMatch(text)
    .replace(/[^a-z0-9'+#]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** True when the text copies a checkpoint: all of a short one, or COPIED_RUN of its words in a row. */
export function copiesCheckpoint(text: string, checkpoints: string[]): boolean {
  const haystack = ` ${wordsOf(text).join(" ")} `;
  return checkpoints.some((checkpoint) => {
    const words = wordsOf(checkpoint);
    if (words.length < 4) return false;
    const run = Math.min(COPIED_RUN, words.length);
    for (let start = 0; start + run <= words.length; start++) {
      if (haystack.includes(` ${words.slice(start, start + run).join(" ")} `)) return true;
    }
    return false;
  });
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const sentenceCount = (text: string) => text.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim() !== "").length;

/** What is wrong with one card, or null. Checkpoints are the grader's answer key, so a card may not copy one. */
export function cardProblem(card: RawCards["cards"][number], map: Pick<SkillMap, "nodes">): string | null {
  const node = map.nodes.find((candidate) => candidate.id === card.nodeId);
  if (!node) return `nodeId "${card.nodeId}" is not one of the topic ids.`;
  const titleWords = wordCount(card.title);
  if (titleWords < 2 || titleWords > 9) return `the title "${card.title}" should be 3 to 7 words.`;
  const bodyWords = wordCount(card.body);
  if (bodyWords < 12 || bodyWords > 110) return `the body of "${card.title}" should be 2 to 4 short sentences.`;
  if (sentenceCount(card.body) > 6) return `the body of "${card.title}" has too many sentences. Use 2 to 4.`;
  if (URL_PATTERN.test(`${card.title} ${card.body}`)) return `"${card.title}" has a link. Never include links.`;
  if (copiesCheckpoint(`${card.title}\n${card.body}`, node.checkpoints)) {
    return `"${card.title}" repeats an answer word for word. Say it in your own words.`;
  }
  return null;
}

/** The first problem with the reply as a whole, for the model's one retry, or null when enough cards are good. */
export function cardsProblem(reply: RawCards, map: Pick<SkillMap, "nodes">): string | null {
  const problems = reply.cards.map((card) => cardProblem(card, map)).filter((problem) => problem !== null);
  const good = reply.cards.length - problems.length;
  if (good >= MIN_GOOD_CARDS) return null;
  return problems[0] ?? `write ${MIN_GOOD_CARDS} or more cards.`;
}

/** The good cards, trimmed and numbered, in the order the model wrote them. Bad ones are dropped quietly. */
export function toTopiclets(reply: RawCards, map: Pick<SkillMap, "id" | "nodes">): Topiclet[] {
  const seen = new Set<string>();
  return reply.cards
    .filter((card) => cardProblem(card, map) === null)
    .filter((card) => {
      const key = card.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CARDS)
    .map((card, index) => ({
      id: `${map.id}.${index}`,
      mapId: map.id,
      nodeId: card.nodeId,
      title: card.title.trim().replace(/[.:]+$/, ""),
      body: card.body.trim().replace(/\s+/g, " "),
    }));
}
