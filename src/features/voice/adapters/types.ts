/**
 * The small interfaces between the interview logic and the outside world. The real
 * versions use the browser and our API routes. Tests and the preview use fakes, so
 * nothing above this line needs a key or a microphone.
 */
import type { FallbackReason } from "../machine";

/** One animation frame's view of an audio signal. */
export type MeterFrame = {
  /** Overall loudness, 0 to 1. */
  level: number;
  /** Loudness per frequency band, 0 to 1, low to high. Length is METER_BANDS. */
  bands: Float32Array;
};

export const METER_BANDS = 16;

export type AudioMeter = {
  /** Fills in the frame. Called on every animation frame, so it must not allocate. */
  read(frame: MeterFrame): void;
};

export const SILENT_METER: AudioMeter = {
  read(frame) {
    frame.level = 0;
    frame.bands.fill(0);
  },
};

export type SpeechKind = "question" | "feedback";

export type SpeechHandlers = {
  onPlaying(): void;
  onEnded(): void;
  onFailed(): void;
};

/** Plays what the server decided to say. It never takes text. */
export type SpeechPort = {
  /** Call during a tap, so the browser allows sound later. */
  unlock(): void;
  play(kind: SpeechKind, handlers: SpeechHandlers): void;
  fadeOut(): void;
  stop(): void;
  /** Seconds played, and the real length once it is known. */
  position(): { seconds: number; duration: number | null };
  meter: AudioMeter;
};

export type MicHandle = {
  meter: AudioMeter;
  /** Pushes out audio the recorder is still holding. */
  flush(): void;
  /** Stops recording and turns the browser's microphone light off. */
  release(): void;
};

/** Why the microphone could not start. */
export class MicError extends Error {
  constructor(readonly reason: Extract<FallbackReason, "mic-denied" | "mic-missing" | "unsupported">) {
    super(reason);
    this.name = "MicError";
  }
}

export type OpenMic = (onChunk: (chunk: Blob | ArrayBuffer) => void) => Promise<MicHandle>;

export type SttGrant = { token: string; wsUrl: string };

/** Returns a short-lived grant from our server. Throws if voice is unavailable. */
export type FetchGrant = () => Promise<SttGrant>;

/** The parts of a browser WebSocket we use. Node 22+ has the same one, which tests rely on. */
export type SocketLike = {
  readyState: number;
  send(data: string | Blob | ArrayBuffer): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type CreateSocket = (url: string, protocols: string[]) => SocketLike;

export type ListenDeps = {
  fetchGrant: FetchGrant;
  openMic: OpenMic;
  createSocket: CreateSocket;
};

export type VoiceAdapters = {
  speech: SpeechPort;
  listen: ListenDeps;
  chime(): void;
  /** Call during a tap, so the browser allows audio analysis. */
  unlockAudio(): void;
};
