import { claimDoc, getDoc, putDoc } from "@/shared/store";
import { interestEvents, marksOf, statsOf, type InterestEvents } from "./events";
import { findSeedPool } from "./fixtures";
import { askModelForCards } from "./generate";
import { engagement, isRetiredShort, mostlySeen, rotatePool, type ItemStats } from "./rank";
import { searchShorts } from "./shorts";
import type { Interest, PoolCard, PoolShort } from "./types";
import { toPoolCards } from "./validate";

/**
 * The shared pool per interest: cards at feed-pool/<slug>, Shorts at feed-shorts/<slug>. Every
 * viewer of an interest ranks the same items, and the pools grow where engagement is high.
 * Suggested interests start from fixtures/pools.json, so the demo needs no AI call.
 */
export const CARD_CAP = 40;
export const SHORT_CAP = 8;
/** Shorts are searched again after this long, or sooner when fewer than LOW_SHORTS still show. */
const SHORTS_FRESH_MS = 3 * 24 * 60 * 60 * 1000;
const SHORTS_RETRY_MS = 24 * 60 * 60 * 1000;
/** In "Videos" a viewer who has seen nearly every Short of an interest may trigger a search this often. */
const SHORTS_EAGER_MS = 6 * 60 * 60 * 1000;
const LOW_SHORTS = 2;
/** After the YouTube API fails (quota or key), stop searching for this long on this server. */
const SHORTS_BACKOFF_MS = 30 * 60 * 1000;
/** Pool documents are re-read after this long. */
const POOL_CACHE_MS = 30_000;
/** Total likes across an interest's cards that earn it a fresh batch (at most once an hour). */
const POPULAR_LIKES = 3;

type CardPoolDoc = { name: string; cards: PoolCard[]; nextN: number; updatedAt: string };
type ShortPoolDoc = { name: string; shorts: PoolShort[]; searchedAt: string };

const globalState = globalThis as typeof globalThis & {
  oryxFeedPools?: Map<string, { at: number; doc: unknown }>;
  oryxShortsBackoffUntil?: number;
};
const poolCache = (globalState.oryxFeedPools ??= new Map());
const inFlight = new Map<string, Promise<PoolCard[]>>();

const cardKey = (slug: string) => `feed-pool/${slug}`;
const shortKey = (slug: string) => `feed-shorts/${slug}`;

async function cachedDoc<T>(key: string, now: number, fresh = false): Promise<T | null> {
  const hit = poolCache.get(key);
  if (!fresh && hit && now - hit.at < POOL_CACHE_MS) return hit.doc as T | null;
  const doc = await getDoc<T>(key);
  poolCache.set(key, { at: Date.now(), doc });
  return doc;
}

async function writeDoc(key: string, doc: unknown) {
  await putDoc(key, doc);
  poolCache.set(key, { at: Date.now(), doc });
}

async function cardDoc(interest: Interest, now = Date.now(), fresh = false): Promise<CardPoolDoc> {
  const stored = await cachedDoc<CardPoolDoc>(cardKey(interest.slug), now, fresh);
  if (stored) return stored;
  const seed = findSeedPool(interest.slug);
  const cards = seed?.cards ?? [];
  return { name: interest.name, cards, nextN: nextNumber(cards), updatedAt: "" };
}

async function shortDoc(interest: Interest, now = Date.now(), fresh = false): Promise<ShortPoolDoc> {
  const stored = await cachedDoc<ShortPoolDoc>(shortKey(interest.slug), now, fresh);
  if (stored) return stored;
  const seed = findSeedPool(interest.slug);
  return { name: interest.name, shorts: seed?.shorts ?? [], searchedAt: seed?.shortsSearchedAt ?? "" };
}

function nextNumber(cards: PoolCard[]): number {
  return cards.reduce((max, card) => Math.max(max, Number(card.id.slice(card.id.lastIndexOf(".c") + 2)) + 1), 0);
}

export async function getCards(interest: Interest): Promise<PoolCard[]> {
  return (await cardDoc(interest)).cards;
}

/** The Shorts that still show: retired ones (mostly skipped, never liked) are left out. */
export async function getShorts(interest: Interest, events?: InterestEvents): Promise<PoolShort[]> {
  const { shorts } = await shortDoc(interest);
  return events ? shorts.filter((short) => !isRetiredShort(statsOf(events, short.id))) : shorts;
}

const statsMap = (items: { id: string }[], events: InterestEvents) => new Map<string, ItemStats>(items.map((item) => [item.id, statsOf(events, item.id)]));

/** Titles of the best-engaged cards (with at least one view), best first. */
export function topCards(cards: PoolCard[], events: InterestEvents, count = 5): PoolCard[] {
  return cards
    .map((card) => ({ card, stats: statsOf(events, card.id) }))
    .filter(({ stats }) => stats.views > 0)
    .sort((a, b) => engagement(b.stats) - engagement(a.stats))
    .slice(0, count)
    .map(({ card }) => card);
}

/**
 * One new batch for an interest: the model gets the best-engaged titles as "what people loved"
 * and every title in the pool to avoid. Then the pool is rotated down to CARD_CAP.
 */
export async function addBatch(interest: Interest): Promise<PoolCard[]> {
  const pending = inFlight.get(interest.slug);
  if (pending) return pending;
  const task = (async () => {
    const [doc, events] = await Promise.all([cardDoc(interest, Date.now(), true), interestEvents(interest.slug)]);
    const usedTitles = doc.cards.map((card) => card.title);
    const loved = topCards(doc.cards, events).map((card) => card.title);
    const reply = await askModelForCards(interest.name, { loved, usedTitles });
    const fresh = toPoolCards(reply, interest.slug, { usedTitles, startAt: doc.nextN });
    const all = [...doc.cards, ...fresh];
    const { keep } = rotatePool(all, statsMap(all, events), CARD_CAP);
    await writeDoc(cardKey(interest.slug), {
      name: interest.name,
      cards: keep,
      nextN: doc.nextN + fresh.length,
      updatedAt: new Date().toISOString(),
    } satisfies CardPoolDoc);
    return keep;
  })().finally(() => inFlight.delete(interest.slug));
  inFlight.set(interest.slug, task);
  return task;
}

const hourStamp = (now: number) => new Date(now).toISOString().slice(0, 13);

/**
 * "More action": a new batch when this viewer has seen most of the pool, the pool is small, or
 * its cards are popular. At most once per interest per hour, across servers (claimDoc).
 */
export async function maybeGrow(interest: Interest, viewerId: string | null, now = Date.now()): Promise<void> {
  const [doc, events] = await Promise.all([cardDoc(interest, now), interestEvents(interest.slug, now)]);
  const ids = doc.cards.map((card) => card.id);
  const marks = new Map(ids.map((id) => [id, marksOf(events, id, viewerId)]));
  const likes = ids.reduce((sum, id) => sum + statsOf(events, id).likes, 0);
  const wanted = doc.cards.length < 8 || mostlySeen(ids, marks) || likes >= POPULAR_LIKES;
  if (!wanted) return;
  if (!(await claimDoc(`feed-gen/${interest.slug}/${hourStamp(now)}`, { at: new Date(now).toISOString() }))) return;
  await addBatch(interest);
}

/**
 * Tops up an interest's Shorts when the pool is old or running low: one search with the
 * subtopic of a best-engaged card, keeping up to 5 new ones, then rotated down to SHORT_CAP.
 */
export async function maybeTopUpShorts(interest: Interest, now = Date.now(), { eager = false }: { eager?: boolean } = {}): Promise<void> {
  if (!process.env.YOUTUBE_API_KEY || (globalState.oryxShortsBackoffUntil ?? 0) > now) return;
  const [doc, cards, events] = await Promise.all([shortDoc(interest, now, true), getCards(interest), interestEvents(interest.slug, now)]);
  const age = doc.searchedAt ? now - Date.parse(doc.searchedAt) : Infinity;
  const live = doc.shorts.filter((short) => !isRetiredShort(statsOf(events, short.id))).length;
  if (!(age > SHORTS_FRESH_MS || (live < LOW_SHORTS && age > SHORTS_RETRY_MS) || (eager && age > SHORTS_EAGER_MS))) return;
  if (!(await claimDoc(`feed-shorts-claim/${interest.slug}/${hourStamp(now)}`, { at: new Date(now).toISOString() }))) return;

  const usedSubtopics = new Set(doc.shorts.map((short) => short.subtopic.toLowerCase()));
  const best = topCards(cards, events).find((card) => !usedSubtopics.has(card.subtopic.toLowerCase()));
  let found: PoolShort[];
  try {
    found = await searchShorts(interest.slug, interest.name, best?.subtopic, { skip: new Set(doc.shorts.map((short) => short.videoId)) });
  } catch (error) {
    globalState.oryxShortsBackoffUntil = now + SHORTS_BACKOFF_MS;
    console.warn("[feed] YouTube search failed, so no new Shorts for now", error instanceof Error ? error.message : error);
    return;
  }
  const all = [...doc.shorts, ...found];
  // Retired Shorts go first, then the weakest judged ones, down to the cap.
  const { keep } = rotatePool(all, statsMap(all, events), SHORT_CAP, 10);
  await writeDoc(shortKey(interest.slug), { name: interest.name, shorts: keep, searchedAt: new Date(now).toISOString() } satisfies ShortPoolDoc);
}

/** True when the item is in its interest's pool, so events for made-up ids are refused. */
export async function itemExists(slug: string, itemId: string, name = slug): Promise<boolean> {
  const interest = { slug, name };
  const [cards, shorts] = await Promise.all([getCards(interest), getShorts(interest)]);
  return cards.some((card) => card.id === itemId) || shorts.some((short) => short.id === itemId);
}

/** The title of a card or Short in its interest's pool, or null when it is not there. */
export async function findItemTitle(slug: string, itemId: string): Promise<string | null> {
  const interest = { slug, name: slug };
  const [cards, shorts] = await Promise.all([getCards(interest), getShorts(interest)]);
  return cards.find((card) => card.id === itemId)?.title ?? shorts.find((short) => short.id === itemId)?.title ?? null;
}
