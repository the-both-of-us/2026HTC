/** Interests and their checks. No server code, so the picker can use them too. */

export type Interest = { slug: string; name: string };

/** At least this many interests before the feed starts, and at most this many in all. */
export const MIN_INTERESTS = 3;
export const MAX_INTERESTS = 12;

const NAMES = [
  "Game theory",
  "Stoicism",
  "Behavioural economics",
  "Black holes",
  "How memory works",
  "Ancient Rome",
  "Negotiation",
  "Personal finance",
  "Evolution",
  "Cryptography",
  "Music theory",
  "Sleep science",
  "Philosophy of mind",
  "Probability",
  "Ocean life",
  "Architecture",
  "Habits and motivation",
  "Linguistics",
  "Space exploration",
  "How AI works",
  "Startups",
  "Chess strategy",
  "Art history",
  "Climate science",
];

/** "Habits and motivation" → "habits-and-motivation". Accents are dropped, anything else becomes a dash. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export const SUGGESTED_INTERESTS: Interest[] = NAMES.map((name) => ({ slug: slugify(name), name }));

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function findSuggestion(slug: string): Interest | undefined {
  return SUGGESTED_INTERESTS.find((interest) => interest.slug === slug);
}

/** Whitespace collapsed, ends trimmed. */
export function cleanInterestName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Words that never make a feed topic here. The model check catches subtler cases. */
const BLOCKED = /\b(porn\w*|sex|sexy|nude\w*|nsfw|onlyfans|suicide|self[- ]harm|kill(ing)?|murder|bomb\w*|terror\w*|nazi\w*|cocaine|meth|heroin|gore|hentai|gambling|casino|betting)\b/i;
const LINK = /https?:\/\/|www\.|\.(com|org|net|io|ca)\b/i;

/** Why a typed interest cannot be used, as a sentence for the learner, or null when it looks fine. */
export function interestNameProblem(raw: string): string | null {
  const name = cleanInterestName(raw);
  if (name.length < 2) return "Type a topic of 2 letters or more.";
  if (name.length > 60) return "Keep it under 60 characters, such as \"Roman engineering\".";
  if (LINK.test(name)) return "Type a topic, not a link.";
  if (!/\p{L}/u.test(name)) return "Type a topic in words, such as \"Volcanoes\".";
  if (!/^[\p{L}\p{N} '&+,.()#-]+$/u.test(name)) return "Use letters, numbers and spaces only.";
  if (BLOCKED.test(name)) return "That topic isn't one the feed covers. Try another.";
  if (slugify(name).length < 2) return "Type a topic of 2 letters or more.";
  return null;
}
