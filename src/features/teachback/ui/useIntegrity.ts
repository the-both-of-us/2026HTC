import { useState } from "react";
import type { IntegritySignals } from "@/shared/types";
import { countWords } from "../learnerText";

/** A pause longer than this does not count as active typing. */
const LONGEST_ACTIVE_GAP_MS = 5_000;

/** Kept with the learner's draft, so reloading the page does not wipe the record of a paste. */
export type SavedIntegrity = { pasted: boolean; activeMs: number };

/**
 * Records how an explanation was written: pasted or not, and active typing time.
 * These are signals shown on the evidence page, never a judgement.
 */
export function createIntegrity(saved?: SavedIntegrity) {
  let pasted = saved?.pasted ?? false;
  let activeMs = saved?.activeMs ?? 0;
  let lastKeystrokeAt: number | null = null;

  return {
    recordTyping() {
      const now = Date.now();
      if (lastKeystrokeAt !== null) {
        const gap = now - lastKeystrokeAt;
        if (gap <= LONGEST_ACTIVE_GAP_MS) activeMs += gap;
      }
      lastKeystrokeAt = now;
    },

    recordPaste() {
      pasted = true;
    },

    /** Emptying the box means starting fresh, so earlier signals no longer describe the text. */
    reset() {
      pasted = false;
      activeMs = 0;
      lastKeystrokeAt = null;
    },

    signalsFor(text: string): Omit<IntegritySignals, "inputMethod"> {
      return { pasted, activeMs, wordCount: countWords(text) };
    },

    toSave(): SavedIntegrity {
      return { pasted, activeMs };
    },
  };
}

export type Integrity = ReturnType<typeof createIntegrity>;

/** One tracker for the life of the panel. */
export function useIntegrity(saved?: SavedIntegrity): Integrity {
  const [integrity] = useState(() => createIntegrity(saved));
  return integrity;
}
