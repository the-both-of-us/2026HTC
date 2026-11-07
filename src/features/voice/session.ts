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
  type TurnUpdate,
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

/** The mic opens this long after the question's sound stops, so its last echo isn't heard. */
export const ECHO_GUARD_MS = 150;
/** A fade-out takes 180 ms in speechPlayer.ts. */
const FADE_MS = 200;

/**
 * After Flux ends a turn, the mic stays open this long. Flux ended turns 0.7 to 1.5 s into
 * a pause in our test, so this lets a pause of about 3 s pass without cutting anyone off.
 * The words show at once, and the countdown runs alongside.
 */
export const HOLD_MS = 2_500;
/** The heard answer sends itself after this, unless the learner steps in. */
export const COUNTDOWN_MS = 3_000;
/** With no words at all after this long, the mic closes and asks them to try again. */
export const NO_WORDS_MS = 20_000;

/** Each of these can move the main button under the pointer. */
const TAPS: ReadonlySet<VoiceEvent["type"]> = new Set(["PRIMARY", "REPLAY", "RERECORD", "RETRY_VOICE"]);

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
  /** When the heard answer sends itself, or null when it won't. */
  countdownEndsAt: number | null;
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
  /** Which visit to "heard" is current, so an old countdown or hold can't act on a new one. */
  private round = 0;
  /** The turn Flux last ended. Words in a later turn, while the mic is held, mean they kept going. */
  private endedTurn = -1;
  /** When the question's sound stopped, or will have stopped after a fade. */
  private quietAt = Number.NEGATIVE_INFINITY;
  private countdownEndsAt: number | null = null;
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
      onTurn: (update) => this.onTurn(update),
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

  /** Downloads the spoken question now, so the first tap plays it at once. */
  prefetch(): void {
    if (this.state.phase === "ready") this.adapters.speech.prefetch("question");
  }

  /** Feeds the orb: the voice when it is talking, the mic when it is listening. */
  activeMeter(): AudioMeter {
    if (this.pinnedMeter) return this.pinnedMeter;
    if (this.state.phase === "listening" || this.state.holding) return this.listener.meter;
    if (this.voiceActive) return this.adapters.speech.meter;
    return SILENT_METER;
  }

  speechPosition(): { seconds: number; duration: number | null } {
    return this.adapters.speech.position();
  }

  send(event: VoiceEvent): void {
    if (this.disposed || this.isSecondTap(event)) return;
    // Every tap goes through here, so this is where the browser's audio gets unlocked.
    if (event.type === "PRIMARY" || event.type === "REPLAY" || event.type === "RERECORD") this.unlock();
    const result = transition(this.state, event);
    // Leaving "heard" cancels its countdown and hold, whatever the next phase is.
    if (this.state.phase === "heard" && result.state.phase !== "heard") this.round += 1;
    this.state = result.state;
    if (!this.state.countdown) this.countdownEndsAt = null;
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

  /** Stops the mic, the socket, the voice and every timer. Safe to call more than once. */
  dispose(): void {
    this.disposed = true;
    this.take += 1;
    this.round += 1;
    this.submitted += 1;
    this.listener.abort();
    this.adapters.speech.stop();
    this.voiceActive = false;
  }

  /** The component mounted. React's Strict Mode disposes once and remounts, so this undoes dispose. */
  activate(): void {
    this.disposed = false;
  }

  private onTurn(update: TurnUpdate): void {
    this.transcript = applyTurn(this.transcript, update);
    this.publish();
    const { phase, holding, closing } = this.state;
    const hasWords = update.transcript.trim().length > 0;
    if (phase === "listening" && !closing && update.event === "EndOfTurn" && fullText(this.transcript).trim()) {
      this.endedTurn = update.turnIndex;
      this.send({ type: "END_OF_TURN" });
    } else if (phase === "heard" && holding && hasWords && update.turnIndex > this.endedTurn) {
      this.send({ type: "RESUMED" });
    }
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
        this.quietAt = this.now() + FADE_MS;
        this.setVoiceActive(false);
        return;
      case "stop-speech":
        this.adapters.speech.stop();
        if (this.voiceActive) this.quietAt = this.now();
        this.setVoiceActive(false);
        return;
      case "arm":
        this.startListening();
        return;
      case "open-mic":
        this.openMic();
        return;
      case "finish-turn":
        void this.finishTurn();
        return;
      case "close-listen":
        this.take += 1;
        this.listener.close();
        this.transcript = settle(this.transcript);
        this.publish();
        return;
      case "abort-listen":
        this.take += 1;
        this.listener.abort();
        return;
      case "clear-answer":
        this.transcript = EMPTY_TRANSCRIPT;
        this.publish();
        return;
      case "start-countdown":
        this.startCountdown();
        return;
      case "start-hold":
        this.after(HOLD_MS, { type: "HOLD_ENDED" });
        return;
      case "submit":
        void this.submit();
        return;
      case "notify-type-instead":
        this.callbacks.onTypeInstead(fullText(this.transcript));
        return;
    }
  }

  /** Opens the mic and the socket, sending silence until openMic lets the mic through. */
  private startListening(): void {
    if (this.listener.active) return;
    this.take += 1;
    this.transcript = startTake(this.transcript);
    this.micLive = false;
    this.endedTurn = -1;
    void this.listener.start({ gated: true });
    this.publish();
  }

  private openMic(): void {
    this.startListening();
    const take = this.take;
    const wait = Math.max(0, this.quietAt + ECHO_GUARD_MS - this.now());
    setTimeout(() => {
      if (take === this.take) this.listener.ungate();
    }, wait);
    // Nobody said anything: close the mic rather than leave it open.
    setTimeout(() => {
      const { phase, closing } = this.state;
      if (take === this.take && phase === "listening" && !closing && !fullText(this.transcript).trim()) {
        this.send({ type: "PRIMARY" });
      }
    }, wait + NO_WORDS_MS);
  }

  private startCountdown(): void {
    this.round += 1;
    this.countdownEndsAt = this.now() + COUNTDOWN_MS;
    this.after(COUNTDOWN_MS, { type: "COUNTDOWN_ENDED" });
    this.publish();
  }

  /** Sends an event later, unless the interview has left this visit to "heard" by then. */
  private after(ms: number, event: VoiceEvent): void {
    const round = this.round;
    setTimeout(() => {
      if (round === this.round) this.send(event);
    }, ms);
  }

  private playSpeech(kind: "question" | "feedback"): void {
    this.adapters.speech.play(kind, {
      onPlaying: () => {
        this.setVoiceActive(true);
        this.send({ type: "SPEECH_PLAYING" });
      },
      onEnded: () => {
        this.quietAt = this.now();
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
      countdownEndsAt: this.countdownEndsAt,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
