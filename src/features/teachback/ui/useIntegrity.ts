import { useRef } from "react";
import type { IntegritySignals } from "@/shared/types";
import { countWords } from "../learnerText";

/** A pause longer than this does not count as active typing. */
const LONGEST_ACTIVE_GAP_MS = 5_000;

/**
 * Records how an explanation was written: pasted or not, active time, typed or spoken.
 * These are signals shown on the evidence page, never a judgement.
 */
export function useIntegrity() {
  const pasted = useRef(false);
  const usedVoice = useRef(false);
  const activeMs = useRef(0);
  const lastKeystrokeAt = useRef<number | null>(null);

  function recordTyping() {
    const now = Date.now();
    if (lastKeystrokeAt.current !== null) {
      const gap = now - lastKeystrokeAt.current;
      if (gap <= LONGEST_ACTIVE_GAP_MS) activeMs.current += gap;
    }
    lastKeystrokeAt.current = now;
  }

  function recordPaste() {
    pasted.current = true;
  }

  function recordSpeaking(durationMs: number) {
    usedVoice.current = true;
    activeMs.current += durationMs;
  }

  /** Emptying the box means starting fresh, so earlier signals no longer describe the text. */
  function reset() {
    pasted.current = false;
    usedVoice.current = false;
    activeMs.current = 0;
    lastKeystrokeAt.current = null;
  }

  function signalsFor(text: string): IntegritySignals {
    return {
      pasted: pasted.current,
      activeMs: activeMs.current,
      wordCount: countWords(text),
      inputMethod: usedVoice.current ? "voice" : "typed",
    };
  }

  return { recordTyping, recordPaste, recordSpeaking, reset, signalsFor };
}

export type Integrity = ReturnType<typeof useIntegrity>;
