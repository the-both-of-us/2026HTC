import { interestEvents, marksOf, statsOf, type InterestEvents } from "./events";
import { getInterests } from "./interests";
import { addBatch, getCards, getShorts, maybeGrow, maybeTopUpShorts } from "./pool";
import { interestWeight, interleave, itemScore } from "./rank";
import { listReactions } from "./reactions";
import { findSuggestion } from "./suggestions";
import type { FeedCard, FeedItem, FeedPage, FeedShort, Interest, PoolCard, PoolShort } from "./types";
import { slugOfItem } from "./validate";

/** Text cards per page. A Short goes after every SHORT_EVERY of them. */
export const CARDS_PER_PAGE = 9;
export const SHORT_EVERY = 3;
/** Interests read per page: each costs a pool read and one event listing. */
const MAX_INTERESTS_PER_PAGE = 12;
/** Ids the browser already has, from ?exclude=. */
const MAX_EXCLUDE = 120;

export type FeedOptions = {
  savedOnly?: boolean;
  /** Item ids already on the viewer's screen this session, left out of this page. */
  exclude?: string[];
  /** Runs work after the response is sent: `after` from next/server in a route. */
  schedule?: (task: () => Promise<void>) => void;
};

type Loaded = { interest: Interest; cards: PoolCard[]; shorts: PoolShort[]; events: InterestEvents };

async function load(interest: Interest): Promise<Loaded> {
  const events = await interestEvents(interest.slug).catch(() => new Map() as InterestEvents);
  const [cards, shorts] = await Promise.all([getCards(interest).catch(() => []), getShorts(interest, events).catch(() => [])]);
  return { interest, cards, shorts, events };
}

const toCard = (card: PoolCard, source: Loaded, viewerId: string | null): FeedCard => {
  const marks = marksOf(source.events, card.id, viewerId);
  return {
    kind: "card",
    id: card.id,
    interest: source.interest,
    title: card.title,
    body: card.body,
    subtopic: card.subtopic,
    liked: marks.liked,
    saved: marks.saved,
  };
};

const toShort = (short: PoolShort, interest: Interest): FeedShort => ({
  kind: "short",
  id: short.id,
  interest,
  subtopic: short.subtopic,
  short: { videoId: short.videoId, title: short.title, channel: short.channel },
});

/** The viewer's saved items, newest pools first. */
async function savedPage(viewerId: string, interests: Interest[]): Promise<FeedPage> {
  const saved = await listReactions(viewerId, "save");
  const bySlug = new Map<string, string[]>();
  for (const id of saved) {
    const slug = slugOfItem(id);
    if (slug) bySlug.set(slug, [...(bySlug.get(slug) ?? []), id]);
  }
  const names = new Map(interests.map((interest) => [interest.slug, interest.name]));
  const sources = await Promise.all(
    [...bySlug.keys()].slice(0, 30).map((slug) => load({ slug, name: names.get(slug) ?? findSuggestion(slug)?.name ?? slug.replace(/-/g, " ") })),
  );
  const items: FeedItem[] = [];
  for (const source of sources) {
    const ids = new Set(bySlug.get(source.interest.slug));
    for (const card of source.cards) if (ids.has(card.id)) items.push(toCard(card, source, viewerId));
    for (const short of source.shorts) if (ids.has(short.id)) items.push(toShort(short, source.interest));
  }
  return { needsInterests: false, interests, items, more: false, total: items.length };
}

/**
 * One page of the feed: the viewer's interests' pools, each ranked by everyone's engagement
 * (with a boost for new items, and items this viewer saw pushed down), merged so interests the
 * viewer engages with get more room, with the best Short of an interest after every third card.
 * Pools that are popular or mostly seen grow after the response.
 */
export async function getFeedPage(viewerId: string | null, { savedOnly = false, exclude = [], schedule = (task) => void task() }: FeedOptions = {}): Promise<FeedPage> {
  const interests = (await getInterests(viewerId)).slice(0, MAX_INTERESTS_PER_PAGE);
  if (savedOnly) return viewerId ? savedPage(viewerId, interests) : { needsInterests: false, interests, items: [], more: false, total: 0 };
  if (interests.length === 0) return { needsInterests: true, interests: [], items: [], more: false, total: 0 };

  let sources = await Promise.all(interests.map(load));
  // A typed interest has no pool until its first batch. Write one now if nothing else can show.
  if (sources.every((source) => source.cards.length === 0)) {
    const empty = sources.find((source) => source.cards.length === 0)!;
    await addBatch(empty.interest, "cerebras").catch((error) => console.warn("[feed] first batch failed", error instanceof Error ? error.message : error));
    sources = await Promise.all(interests.map(load));
  }

  const skip = new Set(exclude.slice(-MAX_EXCLUDE));
  const queues = sources.map((source) => {
    const ids = [...source.cards.map((card) => card.id), ...source.shorts.map((short) => short.id)];
    const total = ids.reduce((sum, id) => sum + statsOf(source.events, id).exposures, 0);
    const score = (id: string) => itemScore(statsOf(source.events, id), marksOf(source.events, id, viewerId), total);
    const rankedCards = source.cards
      .filter((card) => !skip.has(card.id))
      .map((card, index) => ({ card, index, score: score(card.id) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ card }) => card);
    const rankedShorts = source.shorts
      .filter((short) => !skip.has(short.id))
      .map((short) => ({ short, score: score(short.id) }))
      .sort((a, b) => b.score - a.score)
      .map(({ short }) => short);
    const weight = interestWeight(source.cards.map((card) => marksOf(source.events, card.id, viewerId)));
    return { source, weight, rankedCards, rankedShorts };
  });

  const merged = interleave(queues.map((queue) => ({ key: queue.source.interest.slug, weight: queue.weight, items: queue.rankedCards })));
  const page = merged.slice(0, CARDS_PER_PAGE);
  const bySlug = new Map(queues.map((queue) => [queue.source.interest.slug, queue]));
  const shortsUsed = new Set<string>();

  const items: FeedItem[] = [];
  page.forEach(({ key, item }, index) => {
    const queue = bySlug.get(key)!;
    items.push(toCard(item, queue.source, viewerId));
    if ((index + 1) % SHORT_EVERY !== 0) return;
    // The best Short of the interest just shown, or of the latest one shown before it, once per interest per page.
    const pick = page
      .slice(0, index + 1)
      .reverse()
      .map((entry) => bySlug.get(entry.key)!)
      .find((candidate) => !shortsUsed.has(candidate.source.interest.slug) && candidate.rankedShorts.length > 0);
    if (!pick) return;
    shortsUsed.add(pick.source.interest.slug);
    items.push(toShort(pick.rankedShorts[0], pick.source.interest));
  });

  schedule(async () => {
    for (const { interest } of sources) {
      await maybeGrow(interest, viewerId).catch((error) => console.warn("[feed] could not grow a pool", error instanceof Error ? error.message : error));
      await maybeTopUpShorts(interest).catch((error) => console.warn("[feed] could not top up Shorts", error instanceof Error ? error.message : error));
    }
  });

  const total = sources.reduce((sum, source) => sum + source.cards.length, 0);
  return { needsInterests: false, interests, items, more: merged.length > page.length, total };
}
