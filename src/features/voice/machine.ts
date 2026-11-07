/**
 * The voice interview as a pure state machine. No timers, no audio, no React:
 * given a state and an event it returns the next state and the side effects to run.
 * VoiceSession runs those effects, so every rule here can be tested in plain Node.
 *
 *   ready -> thinking -> speaking -> listening -> heard -> checking -> verdict
 *
 * One tap leaves "ready". After that it runs by itself: the mic opens when the question
 * ends, Flux's end of turn moves to "heard", and a short countdown sends the answer.
 * A tap or Space can skip the question, or end the answer early. "your-turn" waits for a
 * tap, after nothing was heard or on coming back from typing.
 *
 * type-instead can be reached from almost anywhere, and always keeps the learner's words.
 */

export type VoicePhase =
  | "ready"
  | "thinking"
  | "speaking"
  | "your-turn"
  | "listening"
  | "heard"
  | "checking"
  | "verdict"
  | "type-instead";

/** Why the interview moved to typing. Each one has its own sentence in the UI. */
export type FallbackReason =
  | "chosen"
  | "mic-denied"
  | "mic-missing"
  | "unsupported"
  | "token"
  | "socket"
  | "no-transcript"
  | "tts";

export type VoiceVerdict = { passed: boolean; feedback: string | null };

export type VoiceNotice = "nothing-heard" | "send-failed" | "no-spoken-question";

export type VoiceState = {
  phase: VoicePhase;
  /** Done was tapped, and the last words are still arriving. Only true while listening. */
  closing: boolean;
  /** In heard: the mic is still open for a moment, in case that was only a pause. */
  holding: boolean;
  /** In heard: the answer sends by itself when the countdown ends. */
  countdown: boolean;
  /** In heard: the text box is open. */
  editing: boolean;
  reason: FallbackReason | null;
  notice: VoiceNotice | null;
  verdict: VoiceVerdict | null;
  /** Where to return to if sending the answer fails. */
  returnTo: "heard" | "type-instead";
};

export type VoiceEvent =
  /** Tap on the main button, or the Space key. What it means depends on the phase. */
  | { type: "PRIMARY" }
  | { type: "SPEECH_PLAYING" }
  | { type: "SPEECH_ENDED" }
  | { type: "SPEECH_FAILED" }
  | { type: "REPLAY" }
  /** Flux ended the turn by itself. */
  | { type: "END_OF_TURN" }
  /** The learner spoke again while the mic was still held open. */
  | { type: "RESUMED" }
  | { type: "HOLD_ENDED" }
  | { type: "TURN_CLOSED"; hasText: boolean }
  | { type: "LISTEN_FAILED"; reason: FallbackReason }
  /** A key was pressed or the answer touched in heard: stop sending by itself. */
  | { type: "STOP_COUNTDOWN" }
  | { type: "EDIT" }
  | { type: "RERECORD" }
  | { type: "COUNTDOWN_ENDED" }
  | { type: "TYPE_INSTEAD" }
  | { type: "RETRY_VOICE" }
  | { type: "SUBMIT" }
  | { type: "VERDICT"; verdict: VoiceVerdict }
  | { type: "SUBMIT_FAILED" };

export type VoiceEffect =
  | "play-question"
  | "play-feedback"
  | "fade-speech"
  | "stop-speech"
  /** Open the mic and socket now, sending silence, so they are ready when the question ends. */
  | "arm"
  /** Let the mic through, once the question's sound has died away. */
  | "open-mic"
  | "finish-turn"
  /** Close a take whose turn Flux already ended. */
  | "close-listen"
  | "abort-listen"
  | "clear-answer"
  | "start-hold"
  | "start-countdown"
  | "submit"
  | "notify-type-instead";

export type Transition = { state: VoiceState; effects: VoiceEffect[] };

export const INITIAL_VOICE_STATE: VoiceState = {
  phase: "ready",
  closing: false,
  holding: false,
  countdown: false,
  editing: false,
  reason: null,
  notice: null,
  verdict: null,
  returnTo: "heard",
};

const VOICE_ROUTE_ENDED: readonly VoicePhase[] = ["checking", "verdict", "type-instead"];

export function transition(state: VoiceState, event: VoiceEvent): Transition {
  const stay: Transition = { state, effects: [] };
  const to = (next: Partial<VoiceState>, effects: VoiceEffect[] = []): Transition => ({
    state: { ...state, notice: null, closing: false, holding: false, countdown: false, editing: false, ...next },
    effects,
  });
  // Leaving heard while the mic is still held open must close it.
  const release: VoiceEffect[] = state.holding ? ["abort-listen"] : [];

  switch (event.type) {
    case "PRIMARY":
      switch (state.phase) {
        case "ready":
          return to({ phase: "thinking" }, ["arm", "play-question"]);
        case "thinking":
          // Tapped before the voice arrived: don't make them wait for a question they can read.
          return to({ phase: "listening" }, ["stop-speech", "open-mic"]);
        case "speaking":
          return to({ phase: "listening" }, ["fade-speech", "open-mic"]);
        case "your-turn":
          return to({ phase: "listening" }, ["arm", "open-mic"]);
        case "listening":
          return state.closing ? stay : { state: { ...state, closing: true }, effects: ["finish-turn"] };
        default:
          return stay;
      }

    case "SPEECH_PLAYING":
      return state.phase === "thinking" ? to({ phase: "speaking" }) : stay;

    case "SPEECH_ENDED":
      return state.phase === "speaking" ? to({ phase: "listening" }, ["open-mic"]) : stay;

    case "SPEECH_FAILED":
      // The question is on screen, and they already chose to answer aloud, so listen anyway.
      return state.phase === "thinking" || state.phase === "speaking"
        ? to({ phase: "listening", notice: "no-spoken-question" }, ["stop-speech", "open-mic"])
        : stay;

    case "REPLAY":
      return state.phase === "your-turn" ? to({ phase: "thinking" }, ["arm", "play-question"]) : stay;

    case "END_OF_TURN":
      if (state.phase !== "listening" || state.closing) return stay;
      return to({ phase: "heard", holding: true, countdown: true }, ["start-countdown", "start-hold"]);

    case "RESUMED":
      return state.phase === "heard" && state.holding ? to({ phase: "listening" }) : stay;

    case "HOLD_ENDED":
      return state.phase === "heard" && state.holding
        ? { state: { ...state, holding: false }, effects: ["close-listen"] }
        : stay;

    case "TURN_CLOSED":
      if (state.phase !== "listening") return stay;
      return event.hasText
        ? to({ phase: "heard", countdown: true }, ["start-countdown"])
        : to({ phase: "your-turn", notice: "nothing-heard" });

    case "LISTEN_FAILED":
      if (state.phase === "heard" && state.holding) {
        // The answer was already heard. Losing the mic now changes nothing.
        return { state: { ...state, holding: false }, effects: ["abort-listen"] };
      }
      return state.phase === "thinking" || state.phase === "speaking" || state.phase === "listening"
        ? to({ phase: "type-instead", reason: event.reason }, ["stop-speech", "abort-listen", "notify-type-instead"])
        : stay;

    case "STOP_COUNTDOWN":
      if (state.phase !== "heard" || (!state.countdown && !state.holding)) return stay;
      return { state: { ...state, countdown: false, holding: false }, effects: release };

    case "EDIT":
      return state.phase === "heard" ? to({ phase: "heard", editing: true }, release) : stay;

    case "RERECORD":
      return state.phase === "heard" ? to({ phase: "listening" }, [...release, "clear-answer", "arm", "open-mic"]) : stay;

    case "COUNTDOWN_ENDED":
      if (state.phase !== "heard" || !state.countdown) return stay;
      return to({ phase: "checking", returnTo: "heard" }, [...release, "submit"]);

    case "TYPE_INSTEAD":
      if (VOICE_ROUTE_ENDED.includes(state.phase)) return stay;
      return to({ phase: "type-instead", reason: "chosen" }, ["stop-speech", "abort-listen", "notify-type-instead"]);

    case "RETRY_VOICE":
      return state.phase === "type-instead" ? to({ phase: "your-turn", reason: null }) : stay;

    case "SUBMIT":
      if (state.phase !== "heard" && state.phase !== "type-instead") return stay;
      return to({ phase: "checking", returnTo: state.phase }, [...release, "submit"]);

    case "VERDICT":
      if (state.phase !== "checking") return stay;
      return to({ phase: "verdict", verdict: event.verdict }, event.verdict.feedback ? ["play-feedback"] : []);

    case "SUBMIT_FAILED":
      return state.phase === "checking" ? to({ phase: state.returnTo, notice: "send-failed" }) : stay;
  }
}
