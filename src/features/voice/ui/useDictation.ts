"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserListenDeps, grantFetcher } from "../adapters/browser";
import { resumeAudio } from "../adapters/audioEngine";
import { SILENT_METER, type AudioMeter, type ListenDeps } from "../adapters/types";
import { Listener } from "../listener";
import type { FallbackReason } from "../machine";
import { applyTurn, EMPTY_TRANSCRIPT, finalText, fullText, interimText, settle, startTake, type Transcript } from "../transcript";

export type DictationStatus = "idle" | "listening" | "finishing";

export type UseDictationOptions = {
  /** The skill being explained. It helps Flux hear its terms. */
  skillTitle: string;
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
export function useDictation({ skillTitle, onText, onFallback, listenDeps }: UseDictationOptions) {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [words, setWords] = useState({ final: "", interim: "" });
  const listenerRef = useRef<Listener | null>(null);
  const transcriptRef = useRef<Transcript>(EMPTY_TRANSCRIPT);
  const callbacks = useRef({ onText, onFallback });

  useEffect(() => {
    callbacks.current = { onText, onFallback };
  });

  useEffect(() => () => listenerRef.current?.abort(), []);

  const start = useCallback(() => {
    if (listenerRef.current) return;
    resumeAudio();
    transcriptRef.current = startTake(EMPTY_TRANSCRIPT);
    setWords({ final: "", interim: "" });
    setStatus("listening");

    const listener = new Listener(listenDeps ?? browserListenDeps(grantFetcher({ skillTitle })), {
      onTurn: (update) => {
        transcriptRef.current = applyTurn(transcriptRef.current, update);
        setWords({ final: finalText(transcriptRef.current), interim: interimText(transcriptRef.current) });
      },
      onFailed: (reason) => {
        listenerRef.current = null;
        setStatus("idle");
        callbacks.current.onFallback?.(reason, fullText(transcriptRef.current));
      },
    });
    listenerRef.current = listener;
    void listener.start();
  }, [listenDeps, skillTitle]);

  const stop = useCallback(async () => {
    const listener = listenerRef.current;
    if (!listener) return;
    setStatus("finishing");
    await listener.finish();
    listenerRef.current = null;
    const text = fullText(settle(transcriptRef.current));
    setStatus("idle");
    setWords({ final: "", interim: "" });
    if (text) callbacks.current.onText(text);
  }, []);

  const cancel = useCallback(() => {
    listenerRef.current?.abort();
    listenerRef.current = null;
    setStatus("idle");
    setWords({ final: "", interim: "" });
  }, []);

  /** For drawing a level. Call it from an animation frame, not during render. */
  const getMeter = useCallback((): AudioMeter => listenerRef.current?.meter ?? SILENT_METER, []);

  return { status, finalText: words.final, interimText: words.interim, start, stop, cancel, getMeter };
}
