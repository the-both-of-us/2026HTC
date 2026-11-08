import { isYoungAudience } from "@/shared/audience";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import type { Short } from "./types";

/**
 * Educational YouTube Shorts for a topic. A search costs 100 of the 10,000 daily quota units,
 * so each (map, topic) is searched at most once every few days, and a failure (no key, quota
 * gone, network) makes the feed text-only, silently.
 */

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
/** A found Short is kept this long. */
export const FOUND_TTL_MS = 5 * 24 * 60 * 60 * 1000;
/** "Nothing suitable" is kept for a day, so a topic with no good Shorts is not searched on every page. */
export const NONE_TTL_MS = 24 * 60 * 60 * 1000;
/** After the API fails (quota or key), stop searching for this long on this server. */
const BACKOFF_MS = 30 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 4_000;

/** Titles that are rarely teaching. Songs are fine for young children. */
const NOT_EDUCATIONAL = /\b(prank|pranks|meme|memes|reaction|reacts?|asmr|tiktok compilation|funny moments|challenge)\b/i;
const SONG = /\b(song|songs|music video|lyrics|remix)\b/i;

type SavedShort = { short: Short | null; searchedAt: string };

const globalState = globalThis as typeof globalThis & { oryxShortsBackoffUntil?: number };

export function shortKey(mapId: string, nodeId: string): string {
  return `feed-shorts/${mapId}/${nodeId}`;
}

/** The search terms: the topic, the course and "explained", with #shorts. */
export function shortQuery(map: Pick<SkillMap, "title">, node: Pick<SkillNode, "title">): string {
  return `${node.title} ${map.title} explained #shorts`.replace(/\s+/g, " ").trim();
}

/** False for titles that look like entertainment rather than teaching. */
export function looksEducational(title: string, audience?: string): boolean {
  if (NOT_EDUCATIONAL.test(title)) return false;
  if (SONG.test(title) && !isYoungAudience(audience)) return false;
  return true;
}

type SearchItem = { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } };

/** YouTube returns titles HTML-escaped. */
function unescape(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** The first suitable result, null when none is, or throws when the API itself failed. */
async function search(map: SkillMap, node: SkillNode, key: string): Promise<Short | null> {
  const params = new URLSearchParams({
    part: "snippet",
    q: shortQuery(map, node),
    type: "video",
    videoDuration: "short",
    videoEmbeddable: "true",
    safeSearch: "strict",
    relevanceLanguage: "en",
    maxResults: "8",
    key,
  });
  const response = await fetch(`${SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`YouTube search answered ${response.status}`);
  const data = (await response.json()) as { items?: SearchItem[] };
  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId;
    const title = unescape(item.snippet?.title ?? "");
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId) || !title) continue;
    if (!looksEducational(title, map.audience)) continue;
    return { videoId, title, channel: unescape(item.snippet?.channelTitle ?? "") };
  }
  return null;
}

/**
 * A Short for this topic, from the cache when it is fresh, or one search now. Null when there
 * is none, no key, or the API failed. Never throws.
 */
export async function findShort(map: SkillMap, node: SkillNode, now = Date.now()): Promise<Short | null> {
  const storeKey = shortKey(map.id, node.id);
  try {
    const saved = await getDoc<SavedShort>(storeKey);
    if (saved) {
      const age = now - Date.parse(saved.searchedAt);
      if (age < (saved.short ? FOUND_TTL_MS : NONE_TTL_MS)) return saved.short;
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey || (globalState.oryxShortsBackoffUntil ?? 0) > now) return saved?.short ?? null;

    let short: Short | null;
    try {
      short = await search(map, node, apiKey);
    } catch (error) {
      globalState.oryxShortsBackoffUntil = now + BACKOFF_MS;
      console.warn("[feed] YouTube search failed, so the feed is text only for now", error instanceof Error ? error.message : error);
      return saved?.short ?? null;
    }
    await putDoc(storeKey, { short, searchedAt: new Date(now).toISOString() } satisfies SavedShort);
    return short;
  } catch (error) {
    console.warn("[feed] could not load a Short", error);
    return null;
  }
}
