/**
 * Runs the state machine: it carries out each effect through the adapters and feeds
 * the results back in as events. There is no React in here, so tests can drive a
 * whole interview in Node. useVoiceInterview is a thin wrapper around this class.
 */
import { SILENT_METER, type AudioMeter, type VoiceAdapters } from "./adapters/types";
import { Listener } from "./listener";
import {
  INITIAL_VOICE_STATE,
  transition,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceState,
  type VoiceVerdict,
} from "./machine";
import {
  applyTurn,
  editTranscript,
  EMPTY_TRANSCRIPT,
  finalText,
  fullText,
  inputMethodOf,
  interimText,
  settle,
  startTake,
  type Transcript,
} from "./transcript";

export type InputMethod = "voice" | "typed";

/** A second tap this soon is one double-click, not a decision to skip ahead. */
export const DOUBLE_TAP_MS = 350;

/**
 * How long an answer can stay in "checking" with no reply. The follow-up route may run for
 * 60 s while the grader retries, and giving up sooner could tell a learner their answer
 * failed while it is still passing, so this waits just past that.
 */
export const SUBMIT_TIMEOUT_MS = 65_000;

/** Each of these can move the main button under the pointer. */
const TAPS: ReadonlySet<VoiceEvent["type"]> = new Set(["PRIMARY", "REPLAY", "SAY_MORE", "RETRY_VOICE"]);

export type VoiceCallbacks = {
  /** Return the verdict to show it here, or nothing if the parent takes over. Throw if sending failed. */
  onAnswer(text: string, inputMethod: InputMethod): Promise<VoiceVerdict | void> | VoiceVerdict | void;
  onTypeInstead(partialText: string): void;
};

export type VoiceSnapshot = {
  state: VoiceState;
  finalText: string;
  interimText: string;
  /** The answer as it stands: what is shown in review, and exactly what is sent. */
  text: string;
  /** True while the voice is audible, in any phase. */
  voiceActive: boolean;
  /** False while the browser may still be asking permission for the microphone. */
  micLive: boolean;
};

type Initial = {
  state?: VoiceState;
  transcript?: Transcript;
  /** Feeds the orb from the start. Only the preview's frozen states use this. */
  meter?: AudioMeter;
  /** The clock, for tests. */
  now?: () => number;
};

export class VoiceSession {
  private state: VoiceState;
  private transcript: Transcript;
  private voiceActive = false;
  private micLive = false;
  private snapshot: VoiceSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly listener: Listener;
  private callbacks: VoiceCallbacks;
  private submitted = 0;
  /** Which listening take is current, so a slow finish from an older one can't move the phase. */
  private take = 0;
  private disposed = false;
  private lastTapAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly pinnedMeter: AudioMeter | null;

  constructor(
    private readonly adapters: VoiceAdapters,
    callbacks: VoiceCallbacks,
    initial: Initial = {},
  ) {
    this.callbacks = callbacks;
    this.state = initial.state ?? INITIAL_VOICE_STATE;
    this.transcript = initial.transcript ?? EMPTY_TRANSCRIPT;
    this.pinnedMeter = initial.meter ?? null;
    this.now = initial.now ?? Date.now;
    this.micLive = this.pinnedMeter !== null;
    this.snapshot = this.buildSnapshot();
    this.listener = new Listener(adapters.listen, {
      onTurn: (update) => {
        this.transcript = applyTurn(this.transcript, update);
        this.publish();
      },
      onFailed: (reason) => this.send({ type: "LISTEN_FAILED", reason }),
      onMicLive: () => {
        this.micLive = true;
        this.publish();
      },
    });
  }

  setCallbacks(callbacks: VoiceCallbacks): void {
    this.callbacks = callbacks;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): VoiceSnapshot => this.snapshot;

  /** Feeds the orb: the voice when it is talking, the mic when it is listening. */
  activeMeter(): AudioMeter {
    if (this.pinnedMeter) return this.pinnedMeter;
    if (this.state.phase === "listening") return this.listener.meter;
    if (this.voiceActive) return this.adapters.speech.meter;
    return SILENT_METER;
  }

  speechPosition(): { seconds: number; duration: number | null } {
    return this.adapters.speech.position();
  }

  send(event: VoiceEvent): void {
    if (this.disposed || this.isSecondTap(event)) return;
    // Every tap goes through here, so this is where the browser's audio gets unlocked.
    if (event.type === "PRIMARY" || event.type === "REPLAY" || event.type === "SAY_MORE") this.unlock();
    const result = transition(this.state, event);
    this.state = result.state;
    this.publish();
    for (const effect of result.effects) this.run(effect);
    // Handling a tap can block the page for a moment, and a second click then waits in line.
    // So the gap counts from when this one finished, not from when it started.
    if (TAPS.has(event.type)) this.lastTapAt = this.now();
  }

  /** The learner changed the text. It now counts as typed, and this exact text is what is sent. */
  edit(text: string): void {
    this.transcript = editTranscript(this.transcript, text);
    this.publish();
  }

  /** Stops the mic, the socket and the voice. Nothing starts again until activate(). Safe to call more than once. */
  dispose(): void {
    this.disposed = true;
    this.take += 1;
    this.submitted += 1;
    this.listener.abort();
    this.adapters.speech.stop();
    this.voiceActive = false;
  }

  /** The component mounted. React's Strict Mode disposes once and remounts, so this undoes dispose. */
  activate(): void {
    this.disposed = false;
  }

  private isSecondTap(event: VoiceEvent): boolean {
    if (!TAPS.has(event.type)) return false;
    const now = this.now();
    const tooSoon = now - this.lastTapAt < DOUBLE_TAP_MS;
    if (tooSoon) this.lastTapAt = now;
    return tooSoon && event.type === "PRIMARY";
  }

  private unlock(): void {
    this.adapters.unlockAudio();
    this.adapters.speech.unlock();
  }

  private run(effect: VoiceEffect): void {
    switch (effect) {
      case "play-question":
        this.playSpeech("question");
        return;
      case "play-feedback":
        this.playSpeech("feedback");
        return;
      case "fade-speech":
        this.adapters.speech.fadeOut();
        this.setVoiceActive(false);
        return;
      case "stop-speech":
        this.adapters.speech.stop();
        this.setVoiceActive(false);
        return;
      case "prepare-listen":
        this.listener.prepare();
        return;
      case "open-mic":
        this.take += 1;
        this.transcript = startTake(this.transcript);
        this.micLive = false;
        void this.listener.start();
        this.publish();
        return;
      case "finish-turn":
        void this.finishTurn();
        return;
      case "abort-listen":
        this.take += 1;
        this.listener.abort();
        return;
      case "chime":
        this.adapters.chime();
        return;
      case "submit":
        void this.submit();
        return;
      case "notify-type-instead":
        this.callbacks.onTypeInstead(fullText(this.transcript));
        return;
    }
  }

  private playSpeech(kind: "question" | "feedback"): void {
    this.adapters.speech.play(kind, {
      onPlaying: () => {
        this.setVoiceActive(true);
        this.send({ type: "SPEECH_PLAYING" });
      },
      onEnded: () => {
        this.setVoiceActive(false);
        this.send({ type: "SPEECH_ENDED" });
      },
      onFailed: () => {
        this.setVoiceActive(false);
        this.send({ type: "SPEECH_FAILED" });
      },
    });
  }

  private async finishTurn(): Promise<void> {
    const take = this.take;
    await this.listener.finish();
    if (take !== this.take) return;
    this.transcript = settle(this.transcript);
    this.send({ type: "TURN_CLOSED", hasText: fullText(this.transcript).trim().length > 0 });
  }

  private async submit(): Promise<void> {
    const attempt = ++this.submitted;
    const text = fullText(this.transcript).trim();
    const giveUp = setTimeout(() => {
      if (attempt !== this.submitted) return;
      this.submitted += 1;
      this.send({ type: "SUBMIT_FAILED" });
    }, SUBMIT_TIMEOUT_MS);
    try {
      const verdict = await this.callbacks.onAnswer(text, inputMethodOf(this.transcript));
      if (attempt === this.submitted && verdict) this.send({ type: "VERDICT", verdict });
    } catch {
      if (attempt === this.submitted) this.send({ type: "SUBMIT_FAILED" });
    } finally {
      clearTimeout(giveUp);
    }
  }

  private setVoiceActive(active: boolean): void {
    if (this.voiceActive === active) return;
    this.voiceActive = active;
    this.publish();
  }

  private buildSnapshot(): VoiceSnapshot {
    return {
      state: this.state,
      finalText: finalText(this.transcript),
      interimText: interimText(this.transcript),
      text: fullText(this.transcript),
      voiceActive: this.voiceActive,
      micLive: this.micLive,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
