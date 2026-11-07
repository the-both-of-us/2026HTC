"use client";

import clsx from "clsx";
import { Accessibility } from "lucide-react";
import { useSyncExternalStore } from "react";
import { isLearningModeOn, setLearningMode, subscribeLearningMode } from "./learningMode";

/** True while Accessible Learning Mode is on. Always false while rendering on the server. */
export function useLearningMode(): boolean {
  return useSyncExternalStore(subscribeLearningMode, isLearningModeOn, () => false);
}

/** An on/off switch for Accessible Learning Mode. `compact` hides the words on small screens. */
export function LearningModeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const on = useLearningMode();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setLearningMode(!on)}
      title="Accessible learning mode: easier-to-read font, larger text, no motion, read aloud"
      className={clsx(
        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control px-2 text-left text-sm font-medium text-ink transition-control hover:bg-raised",
        className,
      )}
    >
      {compact && <Accessibility aria-hidden="true" size={18} className="shrink-0 text-ink-soft sm:hidden" />}
      {/* The track and knob show on and off by position as well as colour. */}
      <span
        aria-hidden="true"
        className={clsx(
          "relative h-6 w-10 shrink-0 rounded-full border transition-control",
          on ? "border-accent bg-accent" : "border-control-edge bg-raised",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 size-[1.125rem] rounded-full transition-control",
            on ? "left-[1.125rem] bg-on-dark" : "left-0.5 bg-ink-soft",
          )}
        />
      </span>
      <span className={clsx(compact && "sr-only sm:not-sr-only")}>Accessible learning mode</span>
    </button>
  );
}
