/**
 * Notices when someone is clearly talking but no words are coming back, which means
 * the speech service has quietly stopped working. Thinking before answering is fine,
 * and so is a noisy room: only a level well above that room's own noise counts, and
 * only while it keeps going. Pure, so it can be tested without a microphone.
 */

export const NO_TRANSCRIPT_LIMIT_MS = 8_000;

/** The first moment of listening measures the room. The mic opens on a tap, so it's rarely speech. */
export const CALIBRATE_MS = 1_000;

/** Talking has to be this many times louder than the room. About 10 dB. */
export const ABOVE_FLOOR = 3;

/** Even in a silent room, anything below this level (0 to 1) isn't someone talking. */
export const LEVEL_UP = 0.06;

/** Talking has short gaps in it. A gap this long means they stopped, so the count starts over. */
export const QUIET_RESET_MS = 1_500;

export type Watchdog = {
  watchedMs: number;
  /** The quietest moment heard while calibrating. Null until there is one. */
  floor: number | null;
  /** How long the current stretch of talking has lasted. */
  voicedMs: number;
  quietMs: number;
};

export const NEW_WATCHDOG: Watchdog = { watchedMs: 0, floor: null, voicedMs: 0, quietMs: 0 };

export function tickWatchdog(
  watchdog: Watchdog,
  input: { elapsedMs: number; level: number; transcriptChanged: boolean },
): { watchdog: Watchdog; expired: boolean } {
  const { elapsedMs, level } = input;

  if (watchdog.watchedMs < CALIBRATE_MS) {
    // The lowest reading, not the average, so a learner who starts at once doesn't count as the
    // room. A reading of exactly 0 only means the analyser has no audio yet.
    const floor = level > 0 ? Math.min(watchdog.floor ?? level, level) : watchdog.floor;
    return { watchdog: { ...watchdog, watchedMs: watchdog.watchedMs + elapsedMs, floor }, expired: false };
  }

  if (input.transcriptChanged) return { watchdog: { ...watchdog, voicedMs: 0, quietMs: 0 }, expired: false };

  const threshold = Math.max(LEVEL_UP, (watchdog.floor ?? 0) * ABOVE_FLOOR);
  if (level >= threshold) {
    const voicedMs = watchdog.voicedMs + elapsedMs;
    return { watchdog: { ...watchdog, voicedMs, quietMs: 0 }, expired: voicedMs >= NO_TRANSCRIPT_LIMIT_MS };
  }
  if (watchdog.voicedMs === 0) return { watchdog, expired: false };

  const quietMs = watchdog.quietMs + elapsedMs;
  if (quietMs >= QUIET_RESET_MS) return { watchdog: { ...watchdog, voicedMs: 0, quietMs: 0 }, expired: false };
  // A gap between words is still part of talking.
  const voicedMs = watchdog.voicedMs + elapsedMs;
  return { watchdog: { ...watchdog, voicedMs, quietMs }, expired: voicedMs >= NO_TRANSCRIPT_LIMIT_MS };
}
