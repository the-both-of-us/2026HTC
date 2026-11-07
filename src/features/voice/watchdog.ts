/**
 * Notices when someone is clearly talking but no words are coming back, which means
 * the speech service has quietly stopped working. Silence doesn't count: thinking
 * before answering is fine. Pure, so it can be tested without a microphone.
 */

export const NO_TRANSCRIPT_LIMIT_MS = 8_000;

/** Above this level (0 to 1) the microphone is hearing something real. */
export const LEVEL_UP = 0.06;

export type Watchdog = { voicedMs: number };

export const NEW_WATCHDOG: Watchdog = { voicedMs: 0 };

export function tickWatchdog(
  watchdog: Watchdog,
  input: { elapsedMs: number; level: number; transcriptChanged: boolean },
): { watchdog: Watchdog; expired: boolean } {
  if (input.transcriptChanged) return { watchdog: NEW_WATCHDOG, expired: false };
  const voicedMs = input.level >= LEVEL_UP ? watchdog.voicedMs + input.elapsedMs : watchdog.voicedMs;
  return { watchdog: { voicedMs }, expired: voicedMs >= NO_TRANSCRIPT_LIMIT_MS };
}
