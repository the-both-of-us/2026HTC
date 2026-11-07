/**
 * Pretend audio, for the design preview only. The orb sees a signal shaped like speech
 * and the "service" streams a script through the same protocol the real one uses.
 */
import { estimateSeconds, splitWords } from "../captions";
import { METER_BANDS, type AudioMeter, type MeterFrame, type SocketLike, type SpeechHandlers, type VoiceAdapters } from "./types";

/** Syllables at about 4 per second, with pauses between phrases, like someone talking. */
export function speechLikeMeter(strength = 1): AudioMeter {
  return {
    read(frame: MeterFrame) {
      const t = performance.now() / 1000;
      const syllable = Math.pow(Math.max(0, Math.sin(t * Math.PI * 4.1)), 1.5);
      const phrase = 0.55 + 0.45 * Math.sin(t * 0.9) * Math.sin(t * 2.3);
      const envelope = Math.max(0, syllable * phrase) * strength;
      frame.level = envelope * 0.8;
      for (let band = 0; band < METER_BANDS; band++) {
        const formant =
          Math.exp(-Math.pow((band - 3 - Math.sin(t * 3) * 1.5) / 2.2, 2)) +
          0.7 * Math.exp(-Math.pow((band - 8.5 - Math.sin(t * 2) * 2) / 2.6, 2));
        frame.bands[band] = Math.min(1, envelope * formant);
      }
    },
  };
}

class MockSocket implements SocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private sequence = 0;
  private turn = 0;
  private spoken: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(words: readonly string[]) {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
      let next = 0;
      this.timer = setInterval(() => {
        if (next >= words.length) return;
        this.spoken.push(words[next++]);
        this.emit("Update");
        if (/[.?!]$/.test(words[next - 1])) this.endTurn("model");
      }, 230);
    }, 150);
  }

  send(data: string | Blob | ArrayBuffer) {
    if (data === '{"type":"ForceEndTurn"}') {
      setTimeout(() => {
        if (this.spoken.length) this.endTurn("manual");
        else this.message({ type: "Warning", code: "FORCE_END_TURN_NO_ACTIVE_TURN" });
      }, 80);
    }
    if (data === '{"type":"CloseStream"}') this.close();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({});
  }

  private endTurn(trigger: string) {
    this.emit("EndOfTurn", { trigger });
    this.turn += 1;
    this.spoken = [];
  }

  private emit(event: string, extra: object = {}) {
    this.message({ type: "TurnInfo", event, turn_index: this.turn, transcript: this.spoken.join(" "), ...extra });
  }

  private message(message: object) {
    this.onmessage?.({ data: JSON.stringify({ sequence_id: ++this.sequence, ...message }) });
  }
}

export type MockOptions = {
  question: string;
  answer: string;
  /** Freezes the caption at this share of the question, for screenshots. */
  frozenFraction?: number;
};

export function createMockAdapters({ question, answer, frozenFraction }: MockOptions): VoiceAdapters {
  const words = splitWords(answer);
  const total = estimateSeconds(splitWords(question));
  let startedAt: number | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  return {
    speech: {
      unlock: () => {},
      play(_kind, handlers: SpeechHandlers) {
        clear();
        timers.push(
          setTimeout(() => {
            startedAt = performance.now();
            handlers.onPlaying();
          }, 900),
          setTimeout(() => {
            startedAt = null;
            handlers.onEnded();
          }, 900 + total * 1000),
        );
      },
      fadeOut: clear,
      stop: clear,
      position() {
        if (frozenFraction !== undefined) return { seconds: total * frozenFraction, duration: total };
        return { seconds: startedAt === null ? 0 : (performance.now() - startedAt) / 1000, duration: total };
      },
      meter: speechLikeMeter(1),
    },
    listen: {
      fetchGrant: async () => ({ token: "mock", wsUrl: "wss://mock" }),
      openMic: async () => ({ meter: speechLikeMeter(0.85), flush: () => {}, release: () => {} }),
      createSocket: () => new MockSocket(words),
    },
    chime: () => {},
    unlockAudio: () => {},
  };
}
