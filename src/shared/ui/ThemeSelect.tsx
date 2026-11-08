"use client";

import clsx from "clsx";
import { useId, useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeTheme, THEMES, type Theme } from "./theme";

/** The chosen theme ("system" until the browser says otherwise). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, currentTheme, () => "system" as Theme);
}

/** Appearance: System, Light, Dark or Eye comfort. A native select, so keyboards and screen readers get it for free. */
export function ThemeSelect({ className }: { className?: string }) {
  const theme = useTheme();
  const id = useId();

  return (
    // Label above the select: the sidebar is too narrow for both on one line.
    <div className={clsx("flex flex-col gap-1 text-sm", className)}>
      <label htmlFor={id} className="font-medium text-ink">
        Appearance
      </label>
      <select
        id={id}
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
        className="min-h-11 w-full cursor-pointer rounded-control border border-control-edge bg-sheet px-2 text-sm font-medium text-ink"
      >
        {THEMES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
