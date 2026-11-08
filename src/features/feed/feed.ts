import { ensureSampleCourses } from "@/features/courses";
import { deriveNodeStates, getSkillMap, listMapsByOwner } from "@/features/skill-map";
import { getMapHabits } from "@/features/streaks";
import { getProgress } from "@/features/teachback";
import type { SkillMap } from "@/shared/types";
import { orderCards, parseCursor, planPage, type MapCards } from "./rank";
import { listReactions } from "./reactions";
import { findShort } from "./shorts";
import { getOrCreateTopiclets, getSavedTopiclets } from "./topiclets";
import type { FeedItem, FeedPage, Topiclet } from "./types";

/** The viewer's newest maps that feed the feed. More would cost a store read each on every page. */
const MAX_MAPS = 8;
/** Maps with no cards yet get them written on a page load, at most this many at a time (one AI call each). */
const MAX_NEW_PER_REQUEST = 2;

type Source = { map: SkillMap; cards: Topiclet[] };

/** Cards for each map: saved ones first; up to MAX_NEW_PER_REQUEST maps without any get one AI call. */
async function loadSources(maps: SkillMap[]): Promise<Source[]> {
  const saved = await Promise.all(maps.map(async (map) => ({ map, cards: await getSavedTopiclets(map).catch(() => null) })));
  const missing = saved.filter((source) => source.cards === null).slice(0, MAX_NEW_PER_REQUEST);
  await Promise.all(
    missing.map(async (source) => {
      try {
        source.cards = await getOrCreateTopiclets(source.map);
      } catch (error) {
        // The AI is down or the reply was bad: this map joins the feed on a later load.
        console.warn(`[feed] could not write cards for a map`, error instanceof Error ? error.message : error);
      }
    }),
  );
  return saved.filter((source): source is Source => source.cards !== null && source.cards.length > 0);
}

/** The viewer's own maps: ones they built, courses they started and their copies of circle maps. */
async function viewerMaps(viewerId: string | null): Promise<SkillMap[]> {
  if (!viewerId) return [];
  const maps = await listMapsByOwner(viewerId).catch(() => []);
  return maps.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_MAPS);
}

async function sampleMaps(): Promise<SkillMap[]> {
  const ids = await ensureSampleCourses().catch(() => []);
  const maps = await Promise.all(ids.map((id) => getSkillMap(id).catch(() => null)));
  return maps.filter((map): map is SkillMap => map !== null);
}

/** Proved, open or locked for each topic, and how far proved ones faded. Samples have no progress. */
async function progressFor(source: Source, viewerId: string | null, own: boolean): Promise<MapCards> {
  const progress = own && viewerId ? await getProgress(source.map.id, viewerId).catch(() => null) : null;
  const states = deriveNodeStates(source.map, progress);
  let dim: Record<string, number> = {};
  if (own && viewerId && progress && Object.keys(progress.proven).length > 0) {
    dim = await getMapHabits(viewerId, source.map.id)
      .then((habits) => habits.dim)
      .catch(() => ({}));
  }
  return { mapId: source.map.id, cards: source.cards, states, dim };
}

export type FeedOptions = { cursor?: string | null; savedOnly?: boolean };

/**
 * One page of the "For you" feed: about 9 text cards from the viewer's maps, taken in turns
 * across maps, with an educational Short after every third card when one is found. A viewer
 * with no maps, or whose maps have no cards yet, gets the sample courses.
 */
export async function getFeedPage(viewerId: string | null, { cursor, savedOnly = false }: FeedOptions = {}): Promise<FeedPage> {
  let sources = await loadSources(await viewerMaps(viewerId));
  let fromSamples = false;
  if (sources.length === 0 && !savedOnly) {
    sources = await loadSources(await sampleMaps());
    fromSamples = true;
  }

  const [ranked, liked, saved] = await Promise.all([
    Promise.all(sources.map((source) => progressFor(source, viewerId, !fromSamples))),
    viewerId ? listReactions(viewerId, "like") : Promise.resolve(new Set<string>()),
    viewerId ? listReactions(viewerId, "save") : Promise.resolve(new Set<string>()),
  ]);

  let ordered = orderCards(ranked);
  if (savedOnly) ordered = ordered.filter((card) => saved.has(card.id));
  const { cards, shortAfter, next } = planPage(ordered, parseCursor(cursor));

  const maps = new Map(sources.map((source) => [source.map.id, source.map]));
  const states = new Map(ranked.map((entry) => [entry.mapId, entry.states]));
  const nodeOf = (card: Topiclet) => maps.get(card.mapId)?.nodes.find((node) => node.id === card.nodeId);

  // Shorts are looked up only for this page, and each topic is cached for days.
  const shorts = savedOnly
    ? []
    : await Promise.all(
        shortAfter.map(async (index) => {
          const card = cards[index];
          const map = maps.get(card.mapId);
          const node = nodeOf(card);
          return map && node ? { index, card, map, node, short: await findShort(map, node) } : null;
        }),
      );

  const items: FeedItem[] = [];
  const seenVideos = new Set<string>();
  cards.forEach((card, index) => {
    const map = maps.get(card.mapId);
    const node = nodeOf(card);
    if (!map || !node) return;
    items.push({
      kind: "card",
      id: card.id,
      mapId: card.mapId,
      nodeId: card.nodeId,
      mapTitle: map.title,
      topicTitle: node.title,
      title: card.title,
      body: card.body,
      proven: states.get(card.mapId)?.[card.nodeId] === "proven",
      liked: liked.has(card.id),
      saved: saved.has(card.id),
    });
    const found = shorts.find((entry) => entry?.index === index);
    if (found?.short && !seenVideos.has(found.short.videoId)) {
      seenVideos.add(found.short.videoId);
      items.push({
        kind: "short",
        id: `short-${found.short.videoId}`,
        mapId: card.mapId,
        nodeId: card.nodeId,
        mapTitle: map.title,
        topicTitle: node.title,
        short: found.short,
      });
    }
  });

  return { items, nextCursor: next === null ? null : String(next), total: ordered.length, fromSamples };
}
