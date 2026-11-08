import { chatJSON } from "@/features/ai";
import { audienceKey } from "@/shared/audience";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { findSampleCards } from "./fixtures";
import { buildCardsPrompt, cardsSystemPrompt, rawCardsSchema, type RawCards } from "./prompt";
import type { Topiclet } from "./types";
import { cardsProblem, toTopiclets } from "./validate";

/** Each request to a provider may take this long. About 10 short cards is a small reply. */
const REQUEST_TIMEOUT_MS = 25_000;

type SavedCards = { cards: Topiclet[]; createdAt: string };

/** Generation in progress, by store key, so two quick feed loads cost one model call. */
const inFlight = new Map<string, Promise<Topiclet[]>>();

/** The audience is part of the key, so cards written for adults are never served to children. */
export function cardsKey(map: Pick<SkillMap, "id" | "audience">): string {
  return `feed-cards/${map.id}${map.audience ? `/${audienceKey(map.audience)}` : ""}`;
}

/** The saved cards for a map, or null when none are written yet. Never calls the AI. */
export async function getSavedTopiclets(map: SkillMap): Promise<Topiclet[] | null> {
  const saved = await getDoc<SavedCards>(cardsKey(map));
  if (saved?.cards) return saved.cards;
  const sample = findSampleCards(map);
  return sample ? toTopiclets(sample, map) : null;
}

/** The map's cards: saved ones, the sample's, or one model call now (then saved). */
export async function getOrCreateTopiclets(map: SkillMap): Promise<Topiclet[]> {
  const saved = await getSavedTopiclets(map);
  if (saved) return saved;

  const key = cardsKey(map);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const reply = await askModelForCards(map);
    const cards = toTopiclets(reply, map);
    await putDoc(key, { cards, createdAt: new Date().toISOString() } satisfies SavedCards);
    return cards;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

/** One model call for a whole map. Gemini first, as for lessons: cards are saved, so writing matters more than speed. */
export async function askModelForCards(map: Pick<SkillMap, "title" | "nodes" | "audience">): Promise<RawCards> {
  const schema = rawCardsSchema.superRefine((reply, context) => {
    const problem = cardsProblem(reply, map);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });
  return chatJSON({
    label: "feed-cards",
    system: cardsSystemPrompt(map.audience),
    prompt: buildCardsPrompt(map),
    schema,
    maxTokens: 3000,
    timeoutMs: REQUEST_TIMEOUT_MS,
    preferredRoute: "gemini",
  });
}
