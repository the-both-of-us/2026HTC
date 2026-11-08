import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import type { CourseRating } from "@/shared/types";
import { chooseTier } from "./router";
import { aiSettingsSchema, DEFAULT_AI_SETTINGS, type AiSettings, type AiTask, type Tier } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** settings/<userId>. User ids are server-made UUIDs; anything else has no settings. */
function settingsKey(userId: string): string | null {
  return UUID_PATTERN.test(userId) ? `settings/${userId}` : null;
}

/** The learner's AI settings, or the defaults (Auto) when none are saved or the store can't be read. */
export async function getAiSettings(userId: string | null | undefined): Promise<AiSettings> {
  const key = userId ? settingsKey(userId) : null;
  if (!key) return DEFAULT_AI_SETTINGS;
  try {
    const saved = await getDoc<unknown>(key);
    if (!saved) return DEFAULT_AI_SETTINGS;
    const parsed = aiSettingsSchema.safeParse(saved);
    return parsed.success ? stripAuto(parsed.data) : DEFAULT_AI_SETTINGS;
  } catch (error) {
    // A settings read must never stop a lesson or a grade: Auto is always a fine answer.
    console.warn(`[settings] could not read settings: ${error instanceof Error ? error.name : "unknown error"}`);
    return DEFAULT_AI_SETTINGS;
  }
}

/** Saves the settings. "Auto" overrides are left out, so the document only holds real choices. */
export async function saveAiSettings(userId: string, settings: AiSettings): Promise<AiSettings> {
  const key = settingsKey(userId);
  if (!key) throw new Error("Settings need a user id.");
  const clean = stripAuto(settings);
  await putDoc(key, clean);
  return clean;
}

/** For "Delete my data". */
export async function deleteAiSettings(userId: string): Promise<void> {
  const key = settingsKey(userId);
  if (key) await deleteDoc(key);
}

function stripAuto(settings: AiSettings): AiSettings {
  const overrides = Object.fromEntries(
    Object.entries(settings.overrides).filter(([, choice]) => choice && choice !== "auto"),
  ) as AiSettings["overrides"];
  return { speed: settings.speed, overrides };
}

/** The tier for this task, this course and this learner's settings. One store read. */
export async function tierFor(task: AiTask, userId: string | null | undefined, rating?: CourseRating): Promise<Tier> {
  return chooseTier(task, rating, await getAiSettings(userId));
}
