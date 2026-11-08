import type { ResourceItem } from "./types";

const TIMEOUT_MS = 5000;
/** Wikimedia rate-limits requests that do not name the app. */
const WIKI_AGENT = "OryxLearn/1.0 (https://oryxlearn.vercel.app)";

/** Only real web addresses are ever shown as links. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.replace(/^http:\/\//, "https://"));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/&quot;|&#39;|&amp;/g, (m) => ({ "&quot;": '"', "&#39;": "'", "&amp;": "&" })[m] ?? m).replace(/\s+/g, " ").trim().slice(0, max) : "";

async function getJSON(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function searchYouTube(query: string, key: string): Promise<ResourceItem[]> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: query,
    maxResults: "3",
    safeSearch: "strict",
    relevanceLanguage: "en",
    videoEmbeddable: "true",
    key,
  });
  const body = (await getJSON(`https://www.googleapis.com/youtube/v3/search?${params}`)) as Json;
  const items: ResourceItem[] = [];
  for (const entry of body.items ?? []) {
    const videoId = entry?.id?.videoId;
    const title = text(entry?.snippet?.title, 140);
    if (typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId) || !title) continue;
    items.push({
      id: `yt-${videoId}`,
      kind: "watch",
      title,
      by: text(entry.snippet.channelTitle, 60),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      thumbnail: httpsUrl(entry.snippet.thumbnails?.medium?.url) ?? undefined,
    });
  }
  return items;
}

/**
 * The Wikipedia article that best matches the skill. Skill titles such as "Counting forward to 20"
 * are rarely article names, so search first, then read that page's summary. Only a standard page
 * (not a disambiguation page) with a summary is shown.
 */
export async function lookupWikipedia(query: string): Promise<ResourceItem[]> {
  const headers = { "Api-User-Agent": WIKI_AGENT, "User-Agent": WIKI_AGENT };
  const found = (await getJSON(
    `https://en.wikipedia.org/w/rest.php/v1/search/page?${new URLSearchParams({ q: query, limit: "1" })}`,
    { headers },
  )) as Json;
  const key = found?.pages?.[0]?.key;
  if (typeof key !== "string" || !key) return [];
  const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers,
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const page = (await response.json()) as Json;
  const url = httpsUrl(page?.content_urls?.desktop?.page);
  const name = text(page?.title, 120);
  if (page?.type !== "standard" || !url || !name || !text(page.extract, 10)) return [];
  return [
    {
      id: `wiki-${name}`,
      kind: "read",
      title: `${name} on Wikipedia`,
      by: "Wikipedia",
      url,
      summary: text(page.extract, 160),
      thumbnail: httpsUrl(page.thumbnail?.source) ?? undefined,
    },
  ];
}

/** Keyless Books calls share a global daily quota that is often used up, so send our Google key when there is one. */
export async function searchBooks(query: string, key?: string): Promise<ResourceItem[]> {
  const params = new URLSearchParams({ q: query, maxResults: "2", printType: "books", langRestrict: "en" });
  if (key) params.set("key", key);
  const body = (await getJSON(`https://www.googleapis.com/books/v1/volumes?${params}`)) as Json;
  const items: ResourceItem[] = [];
  for (const entry of body.items ?? []) {
    const info = entry?.volumeInfo;
    const title = text(info?.title, 140);
    const url = httpsUrl(info?.infoLink) ?? httpsUrl(info?.previewLink);
    if (typeof entry?.id !== "string" || !title || !url) continue;
    items.push({
      id: `book-${entry.id}`,
      kind: "read",
      title,
      by: Array.isArray(info.authors) ? text(info.authors.slice(0, 2).join(", "), 80) : "",
      url,
      summary: text(info.description, 160) || undefined,
      thumbnail: httpsUrl(info.imageLinks?.thumbnail) ?? undefined,
    });
  }
  return items;
}

export async function searchNews(query: string, key: string): Promise<ResourceItem[]> {
  const params = new URLSearchParams({ q: query, lang: "en", max: "3", apikey: key });
  const body = (await getJSON(`https://gnews.io/api/v4/search?${params}`)) as Json;
  const items: ResourceItem[] = [];
  for (const article of body.articles ?? []) {
    const url = httpsUrl(article?.url);
    const title = text(article?.title, 140);
    if (!url || !title) continue;
    items.push({
      id: `news-${url}`,
      kind: "news",
      title,
      by: text(article.source?.name, 60),
      url,
      summary: text(article.description, 160) || undefined,
      thumbnail: httpsUrl(article.image) ?? undefined,
    });
  }
  return items;
}

const TADDY_QUERY = `query($term: String!) { searchForTerm(term: $term, filterForTypes: PODCASTEPISODE, limitPerPage: 3) { podcastEpisodes { uuid name description audioUrl imageUrl podcastSeries { name } } } }`;

export async function searchPodcasts(query: string, key: string, userId: string): Promise<ResourceItem[]> {
  const body = (await getJSON("https://api.taddy.org", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-USER-ID": userId, "X-API-KEY": key },
    body: JSON.stringify({ query: TADDY_QUERY, variables: { term: query } }),
  })) as Json;
  const items: ResourceItem[] = [];
  for (const episode of body.data?.searchForTerm?.podcastEpisodes ?? []) {
    const url = httpsUrl(episode?.audioUrl);
    const title = text(episode?.name, 140);
    if (!episode?.uuid || !url || !title) continue;
    items.push({
      id: `pod-${episode.uuid}`,
      kind: "listen",
      title,
      by: text(episode.podcastSeries?.name, 60),
      url,
      summary: text(episode.description, 160) || undefined,
      thumbnail: httpsUrl(episode.imageUrl) ?? undefined,
    });
  }
  return items;
}
