/**
 * Appearance: System (the default, follows prefers-color-scheme), Light (Seal paper), Dark
 * and Eye comfort. A per-browser choice kept in localStorage and shown as data-theme on
 * <html>, which globals.css styles. "System" means no attribute.
 *
 * Why not a cookie read in the root layout: with cacheComponents, reading cookies there makes
 * every page dynamic and loses the prerendered shell. An inline <head> script that runs
 * before the first paint gives the same no-flash result (see Next's "preventing flash" guide).
 *
 * No React here, so the root layout (a server component) can import the script below.
 */

export type Theme = "system" | "light" | "dark" | "eye";

export const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "eye", label: "Eye comfort" },
];

const STORAGE_KEY = "oryx-theme";
const ATTRIBUTE = "data-theme";
const THEME_EVENT = "oryx-theme-change";

function isStoredTheme(value: unknown): value is Exclude<Theme, "system"> {
  return value === "light" || value === "dark" || value === "eye";
}

/** Runs in <head> before the page paints. Storage can throw, and then the theme follows the system. */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark"||t==="eye")document.documentElement.setAttribute("${ATTRIBUTE}",t)}catch(e){}`;

/** The attribute is the truth on screen. */
export function currentTheme(): Theme {
  const value = document.documentElement.getAttribute(ATTRIBUTE);
  return isStoredTheme(value) ? value : "system";
}

/** The theme actually showing: "system" resolved through prefers-color-scheme. */
export function resolvedTheme(): Exclude<Theme, "system"> {
  const theme = currentTheme();
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute(ATTRIBUTE);
  else root.setAttribute(ATTRIBUTE, theme);
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage is blocked: the theme still applies until this page is closed.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Calls back when the theme changes here, in another tab, or (for System) in the OS. */
export function subscribeTheme(onChange: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY) return;
    const root = document.documentElement;
    if (isStoredTheme(event.newValue)) root.setAttribute(ATTRIBUTE, event.newValue);
    else root.removeAttribute(ATTRIBUTE);
    onChange();
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onChange);
  };
}
