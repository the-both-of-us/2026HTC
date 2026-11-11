import { isPublished } from "@/features/courses";
import { contentIdOf, getSkillMap } from "@/features/skill-map";
import { audienceKey } from "@/shared/audience";
import { HttpError } from "@/shared/http";
import { getDoc, putDoc } from "@/shared/store";
import { planResources } from "./query";
import { lookupWikipedia, searchBooks, searchNews, searchPodcasts, searchYouTube } from "./sources";
import type { ResourceItem, ResourceList } from "./types";

/** YouTube search costs 100 of 10,000 daily quota units, so results are kept for a week. */
const CACHE_DAYS = 7;
type Saved = { items: ResourceItem[]; savedAt: string };

/**
 * Looks one source up in parallel with the others. A missing key or a failure drops only that
 * source. `failed` tells the caller not to cache a result that is missing a source by accident.
 */
export async function gatherResources(
  title: string,
  mapTitle: string,
  audience: string | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<{ items: ResourceItem[]; failed: boolean }> {
  const plan = planResources(title, mapTitle, audience);
  let failed = false;
  const run = (job: (() => Promise<ResourceItem[]>) | null) =>
    job
      ? job().catch(() => {
          failed = true;
          return [] as ResourceItem[];
        })
      : Promise.resolve([] as ResourceItem[]);

  const [watch, wiki, books, podcasts, news] = await Promise.all([
    run(env.YOUTUBE_API_KEY ? () => searchYouTube(plan.query, env.YOUTUBE_API_KEY!) : null),
    run(plan.young ? null : () => lookupWikipedia(title)),
    run(() => searchBooks(plan.query, env.GOOGLE_BOOKS_API_KEY ?? env.YOUTUBE_API_KEY)),
    run(plan.adultSources && env.TADDY_API_KEY && env.TADDY_USER_ID ? () => searchPodcasts(plan.query, env.TADDY_API_KEY!, env.TADDY_USER_ID!) : null),
    run(plan.adultSources && env.GNEWS_API_KEY ? () => searchNews(plan.query, env.GNEWS_API_KEY!) : null),
  ]);
  return { items: [...watch, ...wiki, ...books, ...podcasts, ...news], failed };
}

/** Links for one skill, saved per course (`contentIdOf(map)`), skill and audience. Same access rule as lessons: the owner, or anyone once published. */
export async function getResources(mapId: string, nodeId: string, viewerId: string): Promise<ResourceList> {
  const map = await getSkillMap(mapId);
  const mayRead = map && ((viewerId !== "" && map.ownerId === viewerId) || (await isPublished(map.id)));
  if (!map || !mayRead) throw new HttpError("We could not find that map. Check the link, or build a new one.", 404);
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new HttpError("We could not find that skill on this map.", 404);

  const key = `resources/${contentIdOf(map)}/${node.id}/${audienceKey(map.audience) || "general"}`;
  const saved = await getDoc<Saved>(key);
  if (saved && Date.now() - Date.parse(saved.savedAt) < CACHE_DAYS * 86_400_000) return { items: saved.items };

  const { items, failed } = await gatherResources(node.title, map.title, map.audience);
  if (!failed) await putDoc(key, { items, savedAt: new Date().toISOString() } satisfies Saved);
  return { items };
}
