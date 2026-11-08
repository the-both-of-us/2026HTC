import { isYoungAudience } from "@/shared/audience";

export type ResourcePlan = {
  /** The search words for video, books, news and podcasts. */
  query: string;
  young: boolean;
  /** News and podcasts are for adult and general learners only. */
  adultSources: boolean;
};

const clean = (text: string) => text.replace(/[^\p{L}\p{N} '&+\-.]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * The search words for one skill: its title plus the map's title for context, so
 * "Counting to 100" in "Grade 1 math" finds material at that level. A young audience adds
 * "for kids". The map title is left out when the skill title already contains it.
 */
export function planResources(skillTitle: string, mapTitle: string, audience: string | undefined): ResourcePlan {
  const skill = clean(skillTitle);
  const map = clean(mapTitle);
  const young = isYoungAudience(audience);
  const parts = [skill];
  if (map && !skill.toLowerCase().includes(map.toLowerCase())) parts.push(map);
  if (young) parts.push("for kids");
  return { query: parts.join(" ").slice(0, 120), young, adultSources: !young };
}
