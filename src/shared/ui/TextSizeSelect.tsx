"use client";

import clsx from "clsx";
import { useId, useSyncExternalStore } from "react";
import { currentTextSize, setTextSize, subscribeTextSize, TEXT_SIZES, type TextSize } from "./textSize";

/** Text size: Default, Large or Larger. A native select, like Appearance. */
export function TextSizeSelect({ className }: { className?: string }) {
  const size = useSyncExternalStore(subscribeTextSize, currentTextSize, () => "default" as TextSize);
  const id = useId();

  return (
    <div className={clsx("flex flex-col gap-1 text-sm", className)}>
      <label htmlFor={id} className="font-medium text-ink">
        Text size
      </label>
      <select
        id={id}
        value={size}
        onChange={(event) => setTextSize(event.target.value as TextSize)}
        className="min-h-11 w-full cursor-pointer rounded-control border border-control-edge bg-sheet px-2 text-sm font-medium text-ink"
      >
        {TEXT_SIZES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
