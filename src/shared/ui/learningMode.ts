/**
 * Accessible Learning Mode: a more readable font, larger text and spacing, no motion, and
 * read-aloud buttons. It is a per-browser setting, so it lives in localStorage, and it shows
 * as a data-learning-mode attribute on <html>, which globals.css styles.
 *
 * No React here, so the root layout (a server component) can import the script below.
 */

const STORAGE_KEY = "oryx-learning-mode";
const ATTRIBUTE = "data-learning-mode";
export const LEARNING_MODE_EVENT = "oryx-learning-mode-change";

/**
 * Runs in <head> before the page paints, so the mode never flashes off on load. Storage
 * can throw (private windows, blocked site data), and then the mode just stays off.
 */
export const LEARNING_MODE_SCRIPT = `try{if(localStorage.getItem("${STORAGE_KEY}")==="on")document.documentElement.setAttribute("${ATTRIBUTE}","")}catch(e){}`;

/** The attribute is the truth on screen, whatever storage managed to save. */
export function isLearningModeOn(): boolean {
  return document.documentElement.hasAttribute(ATTRIBUTE);
}

export function setLearningMode(on: boolean): void {
  document.documentElement.toggleAttribute(ATTRIBUTE, on);
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is blocked: the mode still works until this page is closed.
  }
  window.dispatchEvent(new Event(LEARNING_MODE_EVENT));
}

/** Calls back when the mode changes here or in another tab. Returns the unsubscribe. */
export function subscribeLearningMode(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    document.documentElement.toggleAttribute(ATTRIBUTE, event.newValue === "on");
    onChange();
  }
  window.addEventListener(LEARNING_MODE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LEARNING_MODE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** True when the system asks for less motion, or Learning Mode is on. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || isLearningModeOn();
}
