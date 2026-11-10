/**
 * The model router: which model a task gets, from the course's rating and the learner's settings.
 * Pure functions, no I/O, so the whole table is unit tested.
 */
import { isYoungAudience } from "@/shared/audience";
import type { CourseRating, SkillMap } from "@/shared/types";
import { AI_TASKS, CHOICE_TIERS, type AiSettings, type AiTask, type Tier } from "./types";

/** Old maps and anything unrated: an everyday course. */
export const DEFAULT_RATING: CourseRating = { difficulty: 2, stakes: 2 };

/**
 * Two models only, from the benchmark at /settings/models: gpt-oss-120b (tier 1) is fast and as
 * accurate as Claude on math, algebra and computer science; Claude Sonnet (tier 3) is clearly
 * better on psychology, health and law. Haiku scored about the same as gpt-oss-120b at five
 * times the wait, and Opus barely beat Sonnet at 1.6 times the wait, so neither is routed to.
 */
export const OSS: Tier = 1;
export const SONNET: Tier = 3;

/**
 * The lesson tier for a rating: Sonnet when the course is hard (difficulty 3) or accuracy
 * matters (stakes 3, which also covers the subjects where gpt-oss-120b fell behind; see
 * `withSubjectFloor`). Everything else stays on gpt-oss-120b.
 */
export function baseTier({ difficulty, stakes }: CourseRating): Tier {
  return difficulty === 3 || stakes === 3 ? SONNET : OSS;
}

/**
 * Auto, per task:
 * - map outline and lesson: the base tier.
 * - flashcards, quiz, checks (grading, follow-ups) and other (feed, program plans): gpt-oss-120b.
 *   Short items, or a learner waiting on the answer, where speed matters most.
 */
export function autoTier(task: AiTask, rating: CourseRating = DEFAULT_RATING): Tier {
  return task === "lesson" || task === "map" ? baseTier(rating) : OSS;
}

/** The tier for one call: an override wins, then Fast (gpt-oss-120b) or Thorough (Sonnet), then Auto. */
export function chooseTier(task: AiTask, rating: CourseRating | undefined, settings: AiSettings): Tier {
  if (task === "other") return OSS;
  const override = settings.overrides[task];
  if (override && override !== "auto") return CHOICE_TIERS[override];
  if (settings.speed === "fast") return OSS;
  if (settings.speed === "thorough") return SONNET;
  return autoTier(task, rating ?? DEFAULT_RATING);
}

/** True if this task can be overridden on the settings page. */
export function isOverridable(task: AiTask): task is (typeof AI_TASKS)[number] {
  return (AI_TASKS as readonly string[]).includes(task);
}

const level = (value: unknown): 1 | 2 | 3 | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(3, Math.max(1, Math.round(value))) as 1 | 2 | 3;
};

/** The model's rating from a map reply, clamped to 1 to 3, with `fallback` for whatever is missing. */
export function toRating(raw: { difficulty?: unknown; stakes?: unknown }, fallback: CourseRating): CourseRating {
  return { difficulty: level(raw.difficulty) ?? fallback.difficulty, stakes: level(raw.stakes) ?? fallback.stakes };
}

// Words that make accuracy matter: health, electrical and other safety work, law, money, flying.
const HIGH_STAKES =
  /\b(medic\w*|medication|dosage|drugs?|pharmac\w*|nurs\w*|clinical|patients?|surgery|surgical|first aid|cpr|anatomy|electrical|electrician|wiring|high voltage|arc flash|lockout|gas fitt\w*|hazmat|occupational (health|safety)|(workplace|fire|food|patient|process) safety|safety[- ]critical|law|laws|legal|paralegal|lawyer|tax|taxes|accounting|accountant|audit\w*|financ\w*|invest\w*|mortgage|securities|aviation|pilot|structural)\b/i;
// Subjects where gpt-oss-120b fell behind Claude Sonnet in the benchmark: psychology (5 of 8 against
// 8), health and medicine (5 against 6, Opus 7), law (7 against 8) and quantum physics (7 against 8).
const SONNET_SUBJECTS =
  /\b(psycholog\w*|psychiatr\w*|psychotherap\w*|mental health|neuroscien\w*|health\w*|medic\w*|nurs\w*|clinical|anatomy|physiolog\w*|pharmac\w*|law|laws|legal|paralegal|lawyer|quantum)\b/i;

/** A course in one of those subjects counts as stakes 3, so its map and lessons go to Sonnet. */
export function withSubjectFloor(rating: CourseRating, text: string): CourseRating {
  return SONNET_SUBJECTS.test(text.slice(0, GUESS_CHARS)) ? { ...rating, stakes: 3 } : rating;
}

// Hobbies and play: getting a detail wrong costs little.
const LOW_STAKES = /\b(hobby|games?|trivia|fun facts?|knitting|drawing|doodl\w*|guitar|ukulele|gardening|chess|origami|video games?)\b/i;
const HARD =
  /\b(advanced|graduate|phd|doctoral|quantum|compilers?|kernel|distributed systems|cryptograph\w*|machine learning|deep learning|neural networks?|organic chemistry|biochemistry|thermodynamics|differential equations|real analysis|topology|econometrics|senior|principal|staff engineer|architect)\b/i;
const EASY = /\b(intro|introduction|introductory|beginners?|basics|101|getting started|elementary|simple)\b/i;

/** How much of a posting or document the guess reads: its title and opening lines, not every duty. */
const GUESS_CHARS = 400;

/**
 * A cheap guess before any model call, used to pick the model for the map outline itself (the
 * map's real rating comes back with it). Young audiences are 1 and 1. Otherwise keywords move
 * each axis from 2 to 1 or 3.
 */
export function guessRating(text: string, audience = ""): CourseRating {
  if (isYoungAudience(audience)) return { difficulty: 1, stakes: 1 };
  const head = text.slice(0, GUESS_CHARS);
  const difficulty = HARD.test(head) ? 3 : EASY.test(head) ? 1 : 2;
  const stakes = HIGH_STAKES.test(head) ? 3 : LOW_STAKES.test(head) ? 1 : 2;
  return withSubjectFloor({ difficulty, stakes }, head);
}

/**
 * The rating to route a map's lessons, flashcards, quizzes and checks by. Maps built before ratings
 * existed have none, so they get the same guess a new map gets before its first call, and the
 * subject floor reads the program's title too: "Introduction to Psychology" (built Nov 8, no
 * rating) had its lessons written by gpt-oss-120b, when psychology should go to Sonnet.
 */
export function ratingOf(map: Pick<SkillMap, "rating" | "title" | "subtitle" | "audience" | "program">): CourseRating {
  const text = [map.program?.title, map.title, map.subtitle].filter(Boolean).join("\n");
  return withSubjectFloor(map.rating ?? guessRating(text, map.audience), text);
}
