"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createBrowserAdapters } from "../adapters/browser";
import type { AudioMeter, VoiceAdapters } from "../adapters/types";
import type { VoiceState } from "../machine";
import { VoiceSession, type VoiceCallbacks } from "../session";
import type { Transcript } from "../transcript";

export type UseVoiceInterviewOptions = VoiceCallbacks & {
  attemptId: string;
  /** Replaces the browser and the API, for tests and the preview. */
  adapters?: VoiceAdapters;
  /** Starts in a given state, for the preview. */
  initial?: { state?: VoiceState; transcript?: Transcript; meter?: AudioMeter };
};

/** Owns one interview. Remounting with a new attemptId starts a new one: see VoiceInterview. */
export function useVoiceInterview({ attemptId, adapters, initial, onAnswer, onTypeInstead }: UseVoiceInterviewOptions) {
  const [session] = useState(
    () => new VoiceSession(adapters ?? createLazyBrowserAdapters(attemptId), { onAnswer, onTypeInstead }, initial),
  );

  // The latest callbacks are used without restarting the interview when a parent re-renders.
  useEffect(() => session.setCallbacks({ onAnswer, onTypeInstead }));

  // Leaving the page must turn the microphone off. Strict Mode runs this twice, so mounting revives it.
  useEffect(() => {
    session.activate();
    return () => session.dispose();
  }, [session]);

  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { session, snapshot };
}

/**
 * Builds the browser adapters on first use. The session is also created during server
 * rendering, where Audio and WebSocket don't exist, and it only needs them after a tap.
 */
function createLazyBrowserAdapters(attemptId: string): VoiceAdapters {
  let real: VoiceAdapters | null = null;
  const get = () => (real ??= createBrowserAdapters(attemptId));
  return {
    speech: {
      unlock: () => get().speech.unlock(),
      play: (kind, handlers) => get().speech.play(kind, handlers),
      fadeOut: () => real?.speech.fadeOut(),
      stop: () => real?.speech.stop(),
      position: () => real?.speech.position() ?? { seconds: 0, duration: null },
      get meter() {
        return get().speech.meter;
      },
    },
    listen: {
      fetchGrant: () => get().listen.fetchGrant(),
      openMic: (onChunk) => get().listen.openMic(onChunk),
      createSocket: (url, protocols) => get().listen.createSocket(url, protocols),
    },
    chime: () => get().chime(),
    unlockAudio: () => get().unlockAudio(),
  };
}
