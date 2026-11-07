/**
 * Plays the server's audio through an <audio> element wired into Web Audio, so the orb
 * can follow the real voice and a tap can fade it out.
 *
 * The question's request starts as soon as it is on screen (prefetch), so its first audio is
 * already waiting when the tap comes. Deepgram streams it about as fast as it plays, so
 * play() streams the prefetched response rather than waiting for the whole file.
 *
 * Otherwise it fetches first rather than pointing <audio> at the URL, because a media element
 * can't tell a 503 from any other problem. The stream then goes into MediaSource, so
 * speech starts while it is still arriving. Where that isn't available, or for Gemini's
 * WAV, it waits for the whole file, which only costs a little time.
 */
import { analyserMeter, audioContext, createAnalyser } from "./audioEngine";
import { SILENT_METER, type SpeechHandlers, type SpeechKind, type SpeechPort } from "./types";

const FADE_SECONDS = 0.18;
const START_TIMEOUT_MS = 12_000;

/** The shortest valid WAV, played during a tap so Safari allows sound later. */
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export function createSpeechPlayer(urlFor: (kind: SpeechKind) => string): SpeechPort {
  let element: HTMLAudioElement | null = null;
  let gain: GainNode | null = null;
  let meter = SILENT_METER;
  let generation = 0;
  let abort: AbortController | null = null;
  let objectUrl: string | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  /** Responses requested early, each used once. Null means the request failed. */
  const prefetched = new Map<SpeechKind, Promise<Response | null>>();

  function ensureGraph(): HTMLAudioElement {
    if (element) return element;
    element = new Audio();
    const audio = audioContext();
    const source = audio.createMediaElementSource(element);
    gain = audio.createGain();
    const analyser = createAnalyser(audio);
    source.connect(gain).connect(analyser).connect(audio.destination);
    meter = analyserMeter(analyser);
    return element;
  }

  function clearSource(): void {
    abort?.abort();
    abort = null;
    if (startTimer) clearTimeout(startTimer);
    startTimer = null;
    if (element) {
      element.pause();
      element.onplaying = element.onended = element.onerror = null;
      element.removeAttribute("src");
      element.load();
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  async function streamInto(audio: HTMLAudioElement, response: Response, isCurrent: () => boolean, onFail: () => void) {
    const mime = response.headers.get("content-type") ?? "audio/mpeg";
    const canStream = typeof MediaSource !== "undefined" && mime.includes("mpeg") && MediaSource.isTypeSupported("audio/mpeg");
    if (!canStream || !response.body) {
      const blob = await response.blob();
      if (!isCurrent()) return;
      objectUrl = URL.createObjectURL(blob);
      audio.src = objectUrl;
      await audio.play();
      return;
    }

    const source = new MediaSource();
    objectUrl = URL.createObjectURL(source);
    audio.src = objectUrl;
    const playing = audio.play();
    await new Promise((resolve) => source.addEventListener("sourceopen", resolve, { once: true }));
    if (!isCurrent()) return;

    const buffer = source.addSourceBuffer("audio/mpeg");
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (!isCurrent()) return;
        if (done) break;
        buffer.appendBuffer(value as BufferSource);
        await new Promise((resolve) => buffer.addEventListener("updateend", resolve, { once: true }));
        if (!isCurrent()) return;
      }
      source.endOfStream();
    } catch {
      if (isCurrent()) onFail();
    }
    await playing;
  }

  return {
    get meter() {
      return meter;
    },

    unlock() {
      const audio = ensureGraph();
      if (audio.src) return;
      audio.src = SILENCE;
      void audio.play().catch(() => {});
    },

    prefetch(kind: SpeechKind) {
      if (prefetched.has(kind)) return;
      prefetched.set(kind, fetch(urlFor(kind)).catch(() => null));
    },

    play(kind: SpeechKind, handlers: SpeechHandlers) {
      clearSource();
      const audio = ensureGraph();
      const current = ++generation;
      const isCurrent = () => current === generation;
      gain?.gain.cancelScheduledValues(0);
      if (gain) gain.gain.value = 1;

      const fail = () => {
        if (!isCurrent()) return;
        generation += 1;
        clearSource();
        handlers.onFailed();
      };

      audio.onplaying = () => {
        if (!isCurrent()) return;
        if (startTimer) clearTimeout(startTimer);
        startTimer = null;
        handlers.onPlaying();
      };
      audio.onended = () => {
        if (isCurrent()) handlers.onEnded();
      };
      audio.onerror = fail;
      startTimer = setTimeout(fail, START_TIMEOUT_MS);

      abort = new AbortController();
      const early = prefetched.get(kind);
      prefetched.delete(kind);
      void (async () => {
        try {
          const response = (early && (await early)) || (await fetch(urlFor(kind), { signal: abort?.signal }));
          if (!isCurrent()) return;
          if (!response.ok) return fail();
          await streamInto(audio, response, isCurrent, fail);
        } catch {
          fail();
        }
      })();
    },

    fadeOut() {
      generation += 1;
      const fading = element;
      if (!fading || !gain) return;
      fading.onplaying = fading.onended = fading.onerror = null;
      const now = gain.context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS);
      setTimeout(clearSource, FADE_SECONDS * 1000 + 20);
    },

    stop() {
      generation += 1;
      clearSource();
    },

    position() {
      if (!element) return { seconds: 0, duration: null };
      const duration = element.duration;
      return { seconds: element.currentTime, duration: Number.isFinite(duration) && duration > 0 ? duration : null };
    },
  };
}
