/**
 * The four ways to prove a topic, and which one each topic gets. Plain code with no
 * server imports, so the map can show the same badge the server will expect.
 */
import type { ProofFormat } from "@/shared/types";

/** "final" and "pretest" are not ways to prove one topic in its panel. */
export type TopicFormat = Exclude<ProofFormat, "final" | "pretest">;

/** The order formats rotate in. "catch" comes first: it is the one people remember. */
export const FORMAT_ROTATION: TopicFormat[] = ["catch", "explain", "kid", "timed"];

export const FORMAT_LABELS: Record<TopicFormat, { name: string; short: string; prompt: string }> = {
  explain: { name: "Explain it", short: "Explain", prompt: "Explain it in your own words." },
  catch: { name: "Catch the mistake", short: "Catch", prompt: "The AI explains it, with mistakes hidden inside. Find them." },
  kid: { name: "Explain it to a 10-year-old", short: "Age 10", prompt: "Short sentences and everyday words." },
  timed: { name: "Say it in 30 seconds", short: "30 sec", prompt: "Beat the clock. Talk, or type if you can't." },
};

/** For young children, who may be younger than 10 themselves, the "kid" format is explaining to a friend. */
const YOUNG_KID_LABEL = { name: "Explain it to a friend", short: "Friend", prompt: "Short sentences and everyday words." };

/** A format's label. `young` is true on a map pitched at children of about 9 and under. */
export function formatLabel(format: TopicFormat, young = false): { name: string; short: string; prompt: string } {
  return young && format === "kid" ? YOUNG_KID_LABEL : FORMAT_LABELS[format];
}

type Topic = { id: string; prerequisites: string[] };

/**
 * One format per topic, decided by its place in the map, so it is the same every time.
 * Each topic starts from its own slot in the rotation, then skips any format already used
 * by the topic before it or by a topic it builds on. So no two neighbours share one.
 * It also tries to skip its siblings' formats (earlier topics built on the same one), so a
 * row of the map is mixed too, but gives that up when all four are taken.
 */
export function assignFormats(topics: Topic[]): Record<string, TopicFormat> {
  const formats: Record<string, TopicFormat> = {};
  topics.forEach((topic, index) => {
    const neighbours = [...topic.prerequisites, topics[index - 1]?.id];
    const siblings = topics
      .slice(0, index)
      .filter((other) => other.prerequisites.some((id) => topic.prerequisites.includes(id)))
      .map((other) => other.id);
    formats[topic.id] =
      firstFree(index, [...neighbours, ...siblings], formats) ??
      firstFree(index, neighbours, formats) ??
      // Only when a topic builds on four others that use all four formats.
      FORMAT_ROTATION[index % FORMAT_ROTATION.length];
  });
  return formats;
}

/** The first format in the rotation, from this topic's slot, that none of these topics uses. */
function firstFree(index: number, ids: (string | undefined)[], formats: Record<string, TopicFormat>) {
  const taken = new Set(ids.map((id) => (id ? formats[id] : undefined)));
  for (let step = 0; step < FORMAT_ROTATION.length; step += 1) {
    const format = FORMAT_ROTATION[(index + step) % FORMAT_ROTATION.length];
    if (!taken.has(format)) return format;
  }
  return null;
}

/** The highest reading grade that still counts as plain enough for a 10-year-old. */
export const MAX_KID_GRADE = 8;

/**
 * The Flesch-Kincaid grade level, worked out by code, not the AI:
 * 0.39 × words per sentence + 11.8 × syllables per word − 15.59.
 * Syllables are counted as vowel groups, which is close enough for a check like this.
 */
export function readingGrade(text: string): number {
  const words = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
  if (words.length === 0) return 0;
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syllables = words.reduce((sum, word) => sum + syllableCount(word), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

function syllableCount(word: string): number {
  const groups = word.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 0);
}
