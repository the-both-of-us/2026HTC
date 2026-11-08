import type { PoolShort } from "./types";

/**
 * Educational YouTube Shorts for an interest. A search costs 100 of the 10,000 daily quota
 * units, so one search keeps up to 5 and the pool is topped up only every few days.
 */

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const SEARCH_TIMEOUT_MS = 5_000;
/** Kept from one search. */
export const SHORTS_PER_SEARCH = 5;

/** Titles that are rarely teaching. */
const NOT_EDUCATIONAL = /\b(prank|pranks|meme|memes|reaction|reacts?|asmr|tiktok compilation|funny moments|challenge|song|songs|music video|lyrics|remix|gone wrong|vlog|unboxing)\b/i;

/** The search terms: the interest, a subtopic people liked, "explained" and #shorts. */
export function shortQuery(interestName: string, subtopic?: string): string {
  const parts = subtopic && subtopic.toLowerCase() !== interestName.toLowerCase() ? [subtopic, interestName] : [interestName];
  return `${parts.join(" ")} explained #shorts`.replace(/\s+/g, " ").trim();
}

/** False for titles that look like entertainment rather than teaching. Music theory may mention songs. */
export function looksEducational(title: string, interestName = ""): boolean {
  const pattern = /music|song/i.test(interestName) ? /\b(prank|pranks|meme|memes|reaction|reacts?|asmr|funny moments|challenge|gone wrong|vlog|unboxing)\b/i : NOT_EDUCATIONAL;
  return !pattern.test(title);
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

/**
 * One search: up to SHORTS_PER_SEARCH suitable Shorts not already in `skip`. Throws when the
 * API itself failed (no key, quota, network), so the caller can back off.
 */
export async function searchShorts(
  slug: string,
  interestName: string,
  subtopic: string | undefined,
  { apiKey = process.env.YOUTUBE_API_KEY, skip = new Set<string>(), now = new Date() }: { apiKey?: string; skip?: Set<string>; now?: Date } = {},
): Promise<PoolShort[]> {
  if (!apiKey) throw new Error("No YOUTUBE_API_KEY");
  const params = new URLSearchParams({
    part: "snippet",
    q: shortQuery(interestName, subtopic),
    type: "video",
    videoDuration: "short",
    videoEmbeddable: "true",
    safeSearch: "strict",
    relevanceLanguage: "en",
    maxResults: "15",
    key: apiKey,
  });
  const response = await fetch(`${SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`YouTube search answered ${response.status}`);
  const data = (await response.json()) as { items?: SearchItem[] };
  const found: PoolShort[] = [];
  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId;
    const title = unescape(item.snippet?.title ?? "");
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId) || !title || skip.has(videoId)) continue;
    if (!looksEducational(title, interestName)) continue;
    skip.add(videoId);
    found.push({
      id: `${slug}.v${videoId}`,
      videoId,
      title,
      channel: unescape(item.snippet?.channelTitle ?? ""),
      subtopic: subtopic || interestName,
      addedAt: now.toISOString(),
    });
    if (found.length >= SHORTS_PER_SEARCH) break;
  }
  return found;
}
