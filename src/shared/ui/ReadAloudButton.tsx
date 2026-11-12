"use client";

import clsx from "clsx";
import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLearningMode } from "./LearningModeToggle";

const NEVER_CHANGES = () => () => {};

/** Model text can wrap code in backticks, which a voice would read out as noise. */
export function toSpeakable(text: string): string {
  return text.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Reads text aloud with the browser's own voice. It is a reading aid in Learning Mode only:
 * nothing is sent to OryxLearn.
 */
export function ReadAloudButton({ text, what, className }: { text: string; what: string; className?: string }) {
  const learningMode = useLearningMode();
  const supported = useSyncExternalStore(NEVER_CHANGES, () => "speechSynthesis" in window, () => false);
  const [speaking, setSpeaking] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  // Stop reading if this button goes away, for example when the panel closes.
  useEffect(
    () => () => {
      if (utterance.current) window.speechSynthesis.cancel();
    },
    [],
  );

  if (!learningMode || !supported) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    // Only one thing reads at a time, so this also stops any other read-aloud button.
    synth.cancel();
    if (speaking) {
      utterance.current = null;
      setSpeaking(false);
      return;
    }

    const next = new SpeechSynthesisUtterance(toSpeakable(text));
    next.lang = "en-CA";
    next.rate = 0.95;
    next.onend = next.onerror = () => {
      if (utterance.current === next) utterance.current = null;
      setSpeaking(false);
    };
    utterance.current = next;
    synth.speak(next);
    setSpeaking(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Uses your browser's built-in voice. A reading aid."
      className={clsx(
        "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-control border border-rule-strong bg-raised/70 px-3 text-sm font-medium text-ink transition-control hover:border-control-edge hover:bg-raised",
        speaking && "border-accent/60 bg-accent/15",
        className,
      )}
    >
      {speaking ? <Square aria-hidden="true" size={14} /> : <Volume2 aria-hidden="true" size={16} />}
      {speaking ? "Stop reading" : `Read ${what} aloud`}
    </button>
  );
}
