/**
 * Who a map is for, as a short plain phrase such as "Grade 1 students (about 6 years old)".
 * Empty means a general or adult learner, and then every prompt stays exactly as it was.
 * Plain code with no server imports, so the map header can use it too.
 */

const WORD_GRADES = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
];

/** A topic about teaching or raising children is for the adult, not the child. */
const FOR_ADULTS = /\b(teach(?:ing|er|ers)?|tutor(?:ing|s)?|parent(?:ing|s)?|lesson plans?|curriculum design|homeschool(?:ing)? my)\b/i;
const UNIVERSITY = /\b(university|college|uni|undergrad(?:uate)?|graduate|phd|masters?|degree)\b/i;

const MAX_AUDIENCE_LENGTH = 80;

const gradeAudience = (grade: number) =>
  grade === 0 ? "Kindergarten children (about 5 years old)" : `Grade ${grade} students (about ${grade + 5} years old)`;

/**
 * The audience a topic or title plainly names, or "" when it names none. Only obvious cases:
 * a grade, year, age or school level, or "for kids". The model handles everything subtler.
 */
export function inferAudience(text: string): string {
  const t = ` ${text.replace(/\s+/g, " ").toLowerCase()} `;
  if (FOR_ADULTS.test(t)) return "";

  if (/\b(kindergarten|kinder|pre-?k|preschool|pre-school)\b/.test(t)) return "Kindergarten children (about 5 years old)";

  const range = t.match(/\bgrades? (\d{1,2}) ?(?:-|–|to|and) ?(\d{1,2})\b/);
  if (range) {
    const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    if (low >= 1 && high <= 12) return `Grade ${low} to ${high} students (about ${low + 5} to ${high + 5} years old)`;
  }
  const grade =
    t.match(/\b(?:grade|gr\.?) ?(\d{1,2})\b/)?.[1] ??
    t.match(/\b(\d{1,2})(?:st|nd|rd|th)[- ]grade(?:rs?)?\b/)?.[1] ??
    String(WORD_GRADES.findIndex((word) => new RegExp(`\\b${word}[- ]grade(?:rs?)?\\b`).test(t)) + 1);
  if (Number(grade) >= 1 && Number(grade) <= 12) return gradeAudience(Number(grade));

  const year = t.match(/\byear (\d{1,2})\b/)?.[1];
  if (year && !UNIVERSITY.test(t) && Number(year) >= 1 && Number(year) <= 13) {
    return `Year ${year} students (about ${Number(year) + 4} to ${Number(year) + 5} years old)`;
  }

  const age =
    t.match(/\bages? (\d{1,2})\b/)?.[1] ?? t.match(/\b(\d{1,2})[- ]?(?:years?|yrs?)[- ]?olds?\b/)?.[1];
  if (age && Number(age) >= 3 && Number(age) <= 17) return `Children about ${age} years old`;

  if (/\b(elementary|primary)[- ]school\b/.test(t)) return "Elementary school students (about 6 to 11 years old)";
  if (/\b(middle|junior high)[- ]school\b|\bjunior high\b/.test(t)) return "Middle school students (about 11 to 14 years old)";
  if (/\bhigh[- ]school\b|\bsecondary school\b/.test(t)) return "High school students (about 14 to 18 years old)";
  if (/\bfor (?:young |little )?(?:kids|children|a child|my kid|my child)\b|^ kids\b/.test(t)) {
    return "Children (about 6 to 10 years old)";
  }
  return "";
}

/**
 * Makes a model-written audience safe to put in a prompt: one short line of plain words,
 * with no tags or quotes that could break out of it. Returns "" for anything empty.
 */
export function cleanAudience(value: string | undefined | null): string {
  if (!value) return "";
  const line = value
    .replace(/[^\p{L}\p{N} ,()'\-–.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_AUDIENCE_LENGTH)
    .trim();
  if (/^(none|n\/?a|general|adults?|general (audience|learners?)|everyone|anyone)\.?$/i.test(line)) return "";
  return line;
}

/** The youngest age an audience names, or null. Grade N counts as N + 5, kindergarten as 5. */
export function audienceAge(audience: string | undefined): number | null {
  if (!audience) return null;
  const t = audience.toLowerCase();
  // "6 years old", "6-year-old", "6 to 8 years old": the first number of the range is the youngest.
  const ages = [...t.matchAll(/\b(\d{1,2})(?:\s*(?:to|-|–)\s*\d{1,2})?[- ]years?\b/g)].map((m) => Number(m[1]));
  if (ages.length > 0) return Math.min(...ages);
  const age = t.match(/\bages? (\d{1,2})\b/)?.[1];
  if (age) return Number(age);
  if (/\bkindergarten\b/.test(t)) return 5;
  const grade = t.match(/\bgrades? (\d{1,2})\b/)?.[1];
  if (grade) return Number(grade) + 5;
  if (/\b(kids|children|child)\b/.test(t)) return 8;
  return null;
}

/** True for an audience of young children, about 9 and under: lessons get shorter and proving formats friendlier. */
export function isYoungAudience(audience: string | undefined): boolean {
  const age = audienceAge(audience);
  return age !== null && age <= 9;
}

/** A short key part for caches that depend on the audience, so a lesson for adults is never served to children. */
export function audienceKey(audience: string | undefined): string {
  return (audience ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * A map's audience: the saved one, or for a map saved before audiences existed, what its
 * title and program title plainly name. A job posting is always for an adult.
 */
export function audienceForMap(map: { audience?: string; title: string; sourceKind: string; program?: { title: string } }): string {
  if (map.audience !== undefined) return map.audience;
  if (map.sourceKind === "posting") return "";
  return inferAudience(`${map.title} ${map.program?.title ?? ""}`);
}
