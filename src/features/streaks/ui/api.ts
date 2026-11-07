import type { MapHabits, StreakView } from "../rules";

/** Tells the sidebar's flame about a new streak, so it updates without a reload. */
export function announceStreak(streak: StreakView): void {
  window.dispatchEvent(new CustomEvent("oryx:streak", { detail: streak }));
}

/** The streak, today's topic and fading for one map. Null if it can't be loaded: the map works without it. */
export async function fetchMapHabits(mapId: string): Promise<MapHabits | null> {
  try {
    const response = await fetch(`/api/streak?mapId=${encodeURIComponent(mapId)}`);
    if (!response.ok) return null;
    const habits = (await response.json()) as MapHabits;
    announceStreak(habits.streak);
    return habits;
  } catch {
    return null;
  }
}

export type RelightReply =
  | { ok: true; question?: string; passed?: boolean; feedback?: string; streak?: StreakView }
  | { ok: false; message: string };

/** Without an answer, asks for the question. With one, checks it. */
export async function postRelight(mapId: string, nodeId: string, answer?: string): Promise<RelightReply> {
  try {
    const response = await fetch("/api/streak/relight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId, answer }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, message: body.error ?? "That did not work. Please try again." };
    if (body.streak) announceStreak(body.streak);
    return { ok: true, ...body };
  } catch {
    return { ok: false, message: "We could not reach OryxLearn. Check your connection and try again." };
  }
}
