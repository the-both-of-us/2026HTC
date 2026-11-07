import { prefersReducedMotion } from "@/shared/ui";

const SOUND_KEY = "oryx-sound";

/**
 * The learner's own choice wins. Without one, sound is off for people who prefer reduced
 * motion or use Learning Mode, and on evidence pages, which are for reading.
 */
export function isSoundOn(): boolean {
  try {
    const saved = localStorage.getItem(SOUND_KEY);
    if (saved) return saved === "on";
  } catch {
    // Storage can be blocked. Then the default applies.
  }
  return !prefersReducedMotion() && !window.location.pathname.startsWith("/proof");
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Without storage the choice lasts until the page closes.
  }
}

/** Two soft notes, a fifth apart. Each step of a combo raises them a semitone. */
export function playChime(combo: number): void {
  if (!isSoundOn() || typeof AudioContext === "undefined") return;
  const audio = new AudioContext();
  const base = 523.25 * 2 ** (Math.min(Math.max(combo, 1) - 1, 7) / 12);

  [base, base * 1.5].forEach((frequency, index) => {
    const start = audio.currentTime + index * 0.09;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(0.07, start + 0.015);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
    tone.connect(volume).connect(audio.destination);
    tone.start(start);
    tone.stop(start + 0.45);
  });
  setTimeout(() => audio.close(), 1000);
}
