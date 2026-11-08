import { looksEducational } from "@/features/feed";
import { isYoungAudience } from "@/shared/audience";
import type { Reel } from "./types";

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const TIMEOUT_MS = 5_000;

/** Kept from one search: more than are shown, so a removed video's place is taken without searching again. */
export const MAX_SAVED = 8;
/** Longer than this is not a quick watch. YouTube's own "short" filter means under 4 minutes. */
export const MAX_SECONDS = 90;

const clean = (text: string) => text.replace(/[^\p{L}\p{N} '&+\-.]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * The search words: the skill, the context (the map title for a topic or PDF; empty for a job
 * posting, whose title is a role and pulls in career clips) unless the skill already holds it,
 * "for kids" for a young audience, then "explained #shorts" to lean toward teaching Shorts.
 */
export function reelQuery(skillTitle: string, mapTitle: string, audience: string | undefined): string {
  const skill = clean(skillTitle);
  const map = clean(mapTitle);
  const parts = [skill];
  if (map && !skill.toLowerCase().includes(map.toLowerCase())) parts.push(map);
  if (isYoungAudience(audience)) parts.push("for kids");
  return `${parts.join(" ").slice(0, 100)} explained #shorts`;
}

/** "PT1M5S" is 65. Anything else, such as a live stream's "P0D", is null. */
export function parseDuration(iso: string | undefined): number | null {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!match || iso === "PT") return null;
  const [, hours = "0", minutes = "0", secs = "0"] = match;
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(secs);
  return total > 0 ? total : null;
}

const STOP_WORDS = new Set(
  "the and for with from into your you what how why when that this are its use using about basics basic intro introduction explained explain guide learn learning simple easy kids grade level part step steps".split(
    " ",
  ),
);

/** The words that say what a title is about: 3 letters or more, not filler. */
export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
  return [...new Set(words)];
}

/** A rough stem, so "joins", "joining" and "joined" all become "join". */
const stem = (word: string) => {
  const cut = word.replace(/(ing|ed|es|s)$/, "");
  return cut.length >= 3 ? cut : word;
};

/** Whether any word in the haystack is a form of this word ("join" and "joining"), or starts with it ("graph" and "graphs"). */
function mentions(haystack: string[], word: string): boolean {
  const root = stem(word);
  return haystack.some((other) => {
    const otherRoot = stem(other);
    return otherRoot === root || (root.length >= 4 && otherRoot.startsWith(root));
  });
}

/**
 * How clearly a video is about the skill: 2 for each skill word its title or description
 * mentions, plus 1 for each map word. It must mention the skill itself, or it scores 0 and is
 * dropped: a clip that only shares the map's words ("Junior vs senior developer" on a junior
 * developer map) is not about the skill. Hashtags are ignored, since "#programming" is tagging,
 * not teaching.
 */
export function relevance(text: string, skillTitle: string, mapTitle: string): number {
  const haystack = keywords(text.replace(/#[\p{L}\p{N}_]+/gu, " "));
  const skillWords = keywords(skillTitle);
  const mapWords = keywords(mapTitle).filter((word) => !skillWords.includes(word));
  const skillHits = skillWords.filter((word) => mentions(haystack, word)).length;
  const mapHits = mapWords.filter((word) => mentions(haystack, word)).length;
  // A skill title of only filler words ("Basics") leaves the map's words to decide.
  if (skillWords.length > 0 && skillHits === 0) return 0;
  return skillHits * 2 + mapHits;
}

/** YouTube returns titles HTML-escaped. */
const unescape = (text: string) =>
  text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

async function getJSON(url: string): Promise<Json> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`YouTube answered ${response.status}`);
  return (await response.json()) as Json;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Up to MAX_SAVED Shorts for one skill, most relevant first, leaving out the ids in `skip`
 * (videos voted off this skill). One search (100 of the 10,000 daily
 * quota units) and one videos.list call (1 unit) for the length and frame shape, since YouTube's
 * own "short" filter lets through landscape videos up to 4 minutes. Throws when YouTube itself
 * failed (quota, network), so the caller keeps what it had and saves nothing.
 */
export async function searchReels(
  skillTitle: string,
  mapTitle: string,
  audience: string | undefined,
  apiKey: string,
  skip: ReadonlySet<string> = new Set(),
): Promise<Reel[]> {
  const search = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: reelQuery(skillTitle, mapTitle, audience),
    videoDuration: "short",
    videoEmbeddable: "true",
    safeSearch: "strict",
    relevanceLanguage: "en",
    maxResults: "25",
    key: apiKey,
  });
  const found = await getJSON(`${SEARCH_URL}?${search}`);

  const candidates: { videoId: string; title: string; channel: string; score: number; order: number }[] = [];
  for (const [order, entry] of (found.items ?? []).entries()) {
    const videoId = entry?.id?.videoId;
    const title = unescape(String(entry?.snippet?.title ?? "")).trim();
    if (typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId) || !title) continue;
    if (skip.has(videoId) || candidates.some((candidate) => candidate.videoId === videoId)) continue;
    if (!looksEducational(title, `${skillTitle} ${mapTitle}`)) continue;
    const score = relevance(`${title} ${unescape(String(entry.snippet.description ?? ""))}`, skillTitle, mapTitle);
    if (score === 0) continue;
    candidates.push({ videoId, title: title.slice(0, 140), channel: unescape(String(entry.snippet.channelTitle ?? "")).slice(0, 60), score, order });
  }
  if (candidates.length === 0) return [];

  // maxHeight makes YouTube report the embed's width and height, which give the frame shape.
  const details = new URLSearchParams({ part: "contentDetails,player", id: candidates.map((c) => c.videoId).join(","), maxHeight: "640", key: apiKey });
  const videos = await getJSON(`${VIDEOS_URL}?${details}`);
  const byId = new Map<string, Json>((videos.items ?? []).map((item: Json) => [item.id, item]));

  const reels: (Reel & { score: number; order: number })[] = [];
  for (const candidate of candidates) {
    const video = byId.get(candidate.videoId);
    const seconds = parseDuration(video?.contentDetails?.duration);
    if (!video || seconds === null || seconds > MAX_SECONDS) continue;
    const width = Number(video.player?.embedWidth);
    const height = Number(video.player?.embedHeight);
    // Landscape or square plays letterboxed in a 9:16 frame, so only portrait is kept.
    if (width > 0 && height > 0 && height <= width) continue;
    reels.push({ ...candidate, seconds });
  }
  return reels
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_SAVED)
    .map(({ videoId, title, channel, seconds }) => ({ videoId, title, channel, seconds }));
}
