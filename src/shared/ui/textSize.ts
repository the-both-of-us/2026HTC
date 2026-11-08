/**
 * Text size: Default, Large or Larger. A per-browser choice kept in localStorage, like the theme.
 * It sets the root font size as an inline style on <html>, so every rem in the design scales
 * with it and no stylesheet rule is needed. Default removes the style, so Accessible Learning
 * Mode's own larger text (in globals.css) still applies.
 *
 * No React here, so the root layout (a server component) can import the script below.
 */

export type TextSize = "default" | "large" | "larger";

export const TEXT_SIZES: { value: TextSize; label: string; percent: string | null }[] = [
  { value: "default", label: "Default", percent: null },
  { value: "large", label: "Large", percent: "112.5%" },
  { value: "larger", label: "Larger", percent: "125%" },
];

const STORAGE_KEY = "oryx-text-size";
const TEXT_SIZE_EVENT = "oryx-text-size-change";

function percentFor(size: string | null): string | null {
  return TEXT_SIZES.find((option) => option.value === size)?.percent ?? null;
}

/** Runs in <head> before the page paints. Storage can throw, and then the size stays the default. */
export const TEXT_SIZE_SCRIPT = `try{var s={large:"112.5%",larger:"125%"}[localStorage.getItem("${STORAGE_KEY}")];if(s)document.documentElement.style.fontSize=s}catch(e){}`;

/** The inline style is the truth on screen. */
export function currentTextSize(): TextSize {
  const shown = document.documentElement.style.fontSize;
  return TEXT_SIZES.find((option) => option.percent !== null && option.percent === shown)?.value ?? "default";
}

function apply(size: string | null): void {
  document.documentElement.style.fontSize = percentFor(size) ?? "";
}

export function setTextSize(size: TextSize): void {
  apply(size);
  try {
    if (size === "default") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // Storage is blocked: the size still applies until this page is closed.
  }
  window.dispatchEvent(new Event(TEXT_SIZE_EVENT));
}

/** Calls back when the size changes here or in another tab. Returns the unsubscribe. */
export function subscribeTextSize(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    apply(event.newValue);
    onChange();
  }
  window.addEventListener(TEXT_SIZE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(TEXT_SIZE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
