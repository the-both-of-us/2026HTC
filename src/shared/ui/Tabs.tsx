"use client";

import clsx from "clsx";
import type { KeyboardEvent } from "react";

export type TabItem<T extends string> = { id: T; label: string };

type TabsProps<T extends string> = {
  /** Names the group for screen readers, e.g. "What to build a map from". */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Tab ids are `${idPrefix}-${item.id}`, so the panel can point back with aria-labelledby. */
  idPrefix: string;
  /** The id of the one tabpanel these tabs control. */
  panelId: string;
  disabled?: boolean;
  /** "fill" shares the width equally, for phones. */
  className?: string;
};

/** The id of a tab, for the panel's aria-labelledby. */
export const tabId = (idPrefix: string, id: string) => `${idPrefix}-${id}`;

/**
 * Seal's tabs: plain words, and the chosen one is a solid block of ink. Arrow keys, Home and
 * End move between tabs, and only the chosen tab is in the Tab order.
 */
export function Tabs<T extends string>({ label, items, value, onChange, idPrefix, panelId, disabled, className }: TabsProps<T>) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === value);
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null || disabled) return;
    event.preventDefault();
    onChange(items[next].id);
    document.getElementById(tabId(idPrefix, items[next].id))?.focus();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={clsx("flex", className)}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(item.id)}
            className={clsx(
              "relative min-h-11 cursor-pointer px-1.5 text-sm font-semibold transition-control focus-visible:z-10 disabled:cursor-default sm:px-4 sm:text-[0.9375rem]",
              "max-sm:flex-1",
              selected ? "bg-ink font-bold text-on-ink" : "text-ink-soft hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
