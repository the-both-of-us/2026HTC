"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserListenDeps, grantFetcher } from "../adapters/browser";
import { resumeAudio } from "../adapters/audioEngine";
import type { AudioMeter, ListenDeps } from "../adapters/types";
import { Dictation, type DictationStatus } from "../dictation";
import type { FallbackReason } from "../machine";

export type { DictationStatus };

export type UseDictationOptions = {
  /** The skill being explained, on the learner's own map. Its title helps Flux hear its terms. */
  mapId: string;
  nodeId: string;
  /** Called with the finished text when listening ends. */
  onText(text: string): void;
  /** Called if voice stops working. Whatever was heard is passed along, so nothing is lost. */
  onFallback?(reason: FallbackReason, partialText: string): void;
  /** Replaces the browser and the API, for tests. */
  listenDeps?: ListenDeps;
};

/**
 * Dictation through Flux, for the teach-back's explanation box. Each start() is a fresh
 * recording, and onText receives only that recording, for the caller to add to its text.
 */
export function useDictation(options: UseDictationOptions) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [words, setWords] = useState({ final: "", interim: "" });
  const latest = useRef(options);
  const dictationRef = useRef<Dictation | null>(null);

  useEffect(() => {
    latest.current = options;
  });

  const dictation = useCallback(
    () =>
      (dictationRef.current ??= new Dictation(
        () => {
          const { listenDeps, mapId, nodeId } = latest.current;
          return listenDeps ?? browserListenDeps(grantFetcher({ mapId, nodeId }));
        },
        {
          onChange: (nextStatus, nextWords) => {
            setStatus(nextStatus);
            setWords(nextWords);
          },
          onText: (text) => latest.current.onText(text),
          onFallback: (reason, partialText) => latest.current.onFallback?.(reason, partialText),
        },
      )),
    [],
  );

  // Leaving the page must turn the microphone off, and deliver nothing afterwards.
  useEffect(() => () => dictationRef.current?.cancel(), []);

  const start = useCallback(() => {
    resumeAudio();
    dictation().start();
  }, [dictation]);
  const stop = useCallback(() => dictation().stop(), [dictation]);
  const cancel = useCallback(() => dictation().cancel(), [dictation]);

  /** For drawing a level. Call it from an animation frame, not during render. */
  const getMeter = useCallback((): AudioMeter => dictation().meter, [dictation]);

  return { status, finalText: words.final, interimText: words.interim, start, stop, cancel, getMeter };
}
