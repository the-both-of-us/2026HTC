/**
 * The voice interview as a pure state machine. No timers, no audio, no React:
 * given a state and an event it returns the next state and the side effects to run.
 * VoiceSession runs those effects, so every rule here can be tested in plain Node.
 *
 *   ready -> thinking -> speaking -> your-turn -> listening -> heard -> checking -> verdict
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

export type VoiceNotice = "nothing-heard" | "send-failed";

export type VoiceState = {
  phase: VoicePhase;
  /** Done was tapped, and the last words are still arriving. Only true while listening. */
  closing: boolean;
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
  | { type: "TURN_CLOSED"; hasText: boolean }
  | { type: "LISTEN_FAILED"; reason: FallbackReason }
  | { type: "SAY_MORE" }
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
  | "prepare-listen"
  | "open-mic"
  | "finish-turn"
  | "abort-listen"
  | "chime"
  | "submit"
  | "notify-type-instead";

export type Transition = { state: VoiceState; effects: VoiceEffect[] };

export const INITIAL_VOICE_STATE: VoiceState = {
  phase: "ready",
  closing: false,
  reason: null,
  notice: null,
  verdict: null,
  returnTo: "heard",
};

const VOICE_ROUTE_ENDED: readonly VoicePhase[] = ["checking", "verdict", "type-instead"];

export function transition(state: VoiceState, event: VoiceEvent): Transition {
  const stay: Transition = { state, effects: [] };
  const to = (next: Partial<VoiceState>, effects: VoiceEffect[] = []): Transition => ({
    state: { ...state, notice: null, closing: false, ...next },
    effects,
  });

  switch (event.type) {
    case "PRIMARY":
      switch (state.phase) {
        case "ready":
          return to({ phase: "thinking" }, ["play-question"]);
        case "thinking":
          // Tapped before the voice arrived: don't make them wait for a question they can read.
          return to({ phase: "listening" }, ["stop-speech", "open-mic"]);
        case "speaking":
          return to({ phase: "listening" }, ["fade-speech", "open-mic"]);
        case "your-turn":
          return to({ phase: "listening" }, ["open-mic"]);
        case "listening":
          return state.closing ? stay : { state: { ...state, closing: true }, effects: ["finish-turn"] };
        default:
          // In heard, Space does nothing: sending an answer is always a deliberate tap.
          return stay;
      }

    case "SPEECH_PLAYING":
      return state.phase === "thinking" ? to({ phase: "speaking" }, ["prepare-listen"]) : stay;

    case "SPEECH_ENDED":
      return state.phase === "speaking" ? to({ phase: "your-turn" }, ["chime", "prepare-listen"]) : stay;

    case "SPEECH_FAILED":
      // A failed verdict read-aloud changes nothing: the feedback is on screen.
      return state.phase === "thinking" || state.phase === "speaking"
        ? to({ phase: "type-instead", reason: "tts" }, ["stop-speech", "notify-type-instead"])
        : stay;

    case "REPLAY":
      return state.phase === "your-turn" ? to({ phase: "thinking" }, ["play-question"]) : stay;

    case "TURN_CLOSED":
      if (state.phase !== "listening") return stay;
      return event.hasText ? to({ phase: "heard" }) : to({ phase: "your-turn", notice: "nothing-heard" });

    case "LISTEN_FAILED":
      return state.phase === "listening"
        ? to({ phase: "type-instead", reason: event.reason }, ["abort-listen", "notify-type-instead"])
        : stay;

    case "SAY_MORE":
      return state.phase === "heard" ? to({ phase: "listening" }, ["open-mic"]) : stay;

    case "TYPE_INSTEAD":
      if (VOICE_ROUTE_ENDED.includes(state.phase)) return stay;
      return to({ phase: "type-instead", reason: "chosen" }, ["stop-speech", "abort-listen", "notify-type-instead"]);

    case "RETRY_VOICE":
      return state.phase === "type-instead" ? to({ phase: "your-turn", reason: null }) : stay;

    case "SUBMIT":
      if (state.phase !== "heard" && state.phase !== "type-instead") return stay;
      return to({ phase: "checking", returnTo: state.phase }, ["submit"]);

    case "VERDICT":
      if (state.phase !== "checking") return stay;
      return to({ phase: "verdict", verdict: event.verdict }, event.verdict.feedback ? ["play-feedback"] : []);

    case "SUBMIT_FAILED":
      return state.phase === "checking" ? to({ phase: state.returnTo, notice: "send-failed" }) : stay;
  }
}
