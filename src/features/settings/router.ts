/**
 * The model router: which model a task gets, from the course's rating and the learner's settings.
 * Pure functions, no I/O, so the whole table is unit tested.
 */
import { isYoungAudience } from "@/shared/audience";
import type { CourseRating } from "@/shared/types";
import { AI_TASKS, CHOICE_TIERS, type AiSettings, type AiTask, type Tier } from "./types";

/** Old maps and anything unrated: an everyday course. */
export const DEFAULT_RATING: CourseRating = { difficulty: 2, stakes: 2 };

/**
 * The lesson tier for a rating, which the other tasks build on. Everyday courses (nothing at 3)
 * stay on gpt-oss-120b. A 3 on one axis steps up: Haiku when the other axis is 1, Sonnet when it
 * is 2. Opus only for the hardest courses where accuracy matters most.
 *
 *              stakes 1   stakes 2   stakes 3
 *   diff 1        1          1          2
 *   diff 2        1          1          3
 *   diff 3        2          3          4
 */
export function baseTier({ difficulty, stakes }: CourseRating): Tier {
  if (difficulty === 3 && stakes === 3) return 4;
  if (difficulty < 3 && stakes < 3) return 1;
  return Math.min(difficulty, stakes) === 1 ? 2 : 3;
}

/**
 * Auto, per task:
 * - lesson: the base tier.
 * - map: one step above lessons for a hard course, but at most Sonnet, since the learner waits
 *   on the whole map at once (Opus there only with Thorough or an override).
 * - flashcards, quiz: at most Haiku. Short items, and they are saved.
 * - checks (grading, follow-ups): gpt-oss-120b, which is under a second and graded strictly in our
 *   eval. Haiku only when stakes are 3.
 * - other (feed, program plans): always gpt-oss-120b.
 */
export function autoTier(task: AiTask, rating: CourseRating = DEFAULT_RATING): Tier {
  const base = baseTier(rating);
  switch (task) {
    case "lesson":
      return base;
    case "map":
      return base === 1 ? 1 : (Math.min(base + 1, 3) as Tier);
    case "flashcards":
    case "quiz":
      return base >= 3 ? 2 : 1;
    case "checks":
      return rating.stakes === 3 ? 2 : 1;
    case "other":
      return 1;
  }
}

/** The tier for one call: an override wins, then Fast (tier 1) or Thorough (one step up, at most Opus), then Auto. */
export function chooseTier(task: AiTask, rating: CourseRating | undefined, settings: AiSettings): Tier {
  if (task === "other") return 1;
  const override = settings.overrides[task];
  if (override && override !== "auto") return CHOICE_TIERS[override];
  if (settings.speed === "fast") return 1;
  const auto = autoTier(task, rating ?? DEFAULT_RATING);
  return settings.speed === "thorough" ? (Math.min(auto + 1, 4) as Tier) : auto;
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
  return { difficulty, stakes };
}
