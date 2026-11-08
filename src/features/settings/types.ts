/**
 * The settings a learner can change on /settings, and the words the page shows for them.
 * No server code here, so the settings page (a client component) can use it too.
 */
import { z } from "zod";

/** 1 is gpt-oss-120b (fast, the default for general material), then Claude Haiku, Sonnet and Opus. */
export type Tier = 1 | 2 | 3 | 4;

/** The jobs the router picks a model for. "other" (feed, program plans) always stays on tier 1. */
export const AI_TASKS = ["map", "lesson", "flashcards", "quiz", "checks"] as const;
export type AiTask = (typeof AI_TASKS)[number] | "other";

export const TASK_LABELS: Record<(typeof AI_TASKS)[number], { label: string; hint: string }> = {
  map: { label: "Map outline", hint: "The skills, their order and checkpoints, written when a map is built." },
  lesson: { label: "Lessons", hint: "The Read tab. Written once per skill and saved." },
  flashcards: { label: "Flashcards", hint: "Written once per skill and saved." },
  quiz: { label: "Quiz", hint: "Written once per skill and saved." },
  checks: { label: "Answer checks", hint: "Grading your explanation and follow-up. Speed matters here." },
};

export const SPEEDS = ["auto", "fast", "thorough"] as const;
export type Speed = (typeof SPEEDS)[number];

export const SPEED_LABELS: Record<Speed, { label: string; hint: string }> = {
  auto: { label: "Auto (recommended)", hint: "Fast for everyday topics. Stronger models for hard or high-stakes courses." },
  fast: { label: "Fast", hint: "The quickest model everywhere. Nothing waits more than a few seconds." },
  thorough: { label: "Thorough", hint: "One step stronger than Auto. Slower, for when you'd rather wait." },
};

export const MODEL_CHOICES = ["auto", "oss", "haiku", "sonnet", "opus"] as const;
export type ModelChoice = (typeof MODEL_CHOICES)[number];

export const MODEL_LABELS: Record<ModelChoice, string> = {
  auto: "Auto",
  oss: "gpt-oss-120b (fastest)",
  haiku: "Claude Haiku",
  sonnet: "Claude Sonnet",
  opus: "Claude Opus (slowest)",
};

/** The tier each fixed choice means. */
export const CHOICE_TIERS: Record<Exclude<ModelChoice, "auto">, Tier> = { oss: 1, haiku: 2, sonnet: 3, opus: 4 };

/** What is stored at settings/<userId>. Unknown or bad values fall back to Auto, so an old document still loads. */
const choice = z.enum(MODEL_CHOICES).optional().catch(undefined);
export const aiSettingsSchema = z.object({
  speed: z.enum(SPEEDS).catch("auto"),
  overrides: z
    .object({ map: choice, lesson: choice, flashcards: choice, quiz: choice, checks: choice })
    .catch({}),
});

/** What PUT /api/settings accepts. Strict, so a typo is a 400 instead of a silent Auto. */
const strictChoice = z.enum(MODEL_CHOICES).optional();
export const aiSettingsInputSchema = z.object({
  speed: z.enum(SPEEDS),
  overrides: z
    .object({ map: strictChoice, lesson: strictChoice, flashcards: strictChoice, quiz: strictChoice, checks: strictChoice })
    .strict(),
});

export type AiSettings = { speed: Speed; overrides: Partial<Record<(typeof AI_TASKS)[number], ModelChoice>> };

export const DEFAULT_AI_SETTINGS: AiSettings = { speed: "auto", overrides: {} };
