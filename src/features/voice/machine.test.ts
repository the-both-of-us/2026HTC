import { describe, expect, it } from "vitest";
import { INITIAL_VOICE_STATE, transition, type VoiceEvent, type VoicePhase, type VoiceState } from "./machine";

function at(phase: VoicePhase, extra: Partial<VoiceState> = {}): VoiceState {
  return { ...INITIAL_VOICE_STATE, phase, ...extra };
}

function run(events: VoiceEvent[], from = INITIAL_VOICE_STATE) {
  let state = from;
  const effects: string[] = [];
  for (const event of events) {
    const result = transition(state, event);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

describe("the happy path", () => {
  it("needs one tap: the mic opens when the question ends, and the answer sends itself", () => {
    const { state, effects } = run([
      { type: "PRIMARY" },
      { type: "SPEECH_PLAYING" },
      { type: "SPEECH_ENDED" },
      { type: "END_OF_TURN" },
      { type: "HOLD_ENDED" },
      { type: "COUNTDOWN_ENDED" },
      { type: "VERDICT", verdict: { passed: true, feedback: "Good." } },
    ]);
    expect(state.phase).toBe("verdict");
    expect(effects).toEqual([
      "arm",
      "play-question",
      "open-mic",
      "start-countdown",
      "start-hold",
      "close-listen",
      "submit",
      "play-feedback",
    ]);
  });

  it("keeps the mic shut while the question plays: arm sends silence until open-mic", () => {
    const { state, effects } = run([{ type: "PRIMARY" }, { type: "SPEECH_PLAYING" }]);
    expect(state.phase).toBe("speaking");
    expect(effects).toEqual(["arm", "play-question"]);
  });
});

describe("a pause that wasn't the end", () => {
  it("goes back to listening if they speak while the mic is held", () => {
    const { state } = run([{ type: "END_OF_TURN" }, { type: "RESUMED" }], at("listening"));
    expect(state.phase).toBe("listening");
    expect(state.countdown).toBe(false);
  });

  it("ignores speech once the hold is over", () => {
    const { state } = run([{ type: "END_OF_TURN" }, { type: "HOLD_ENDED" }, { type: "RESUMED" }], at("listening"));
    expect(state.phase).toBe("heard");
  });

  it("does not take an end of turn from Flux while Done is already finishing", () => {
    expect(transition(at("listening", { closing: true }), { type: "END_OF_TURN" }).state.phase).toBe("listening");
  });
});

describe("the countdown", () => {
  const counting = at("heard", { countdown: true, holding: true });

  it("stops on a key, and closes the held mic", () => {
    const result = transition(counting, { type: "STOP_COUNTDOWN" });
    expect(result.state).toMatchObject({ phase: "heard", countdown: false, holding: false });
    expect(result.effects).toEqual(["abort-listen"]);
    expect(transition(result.state, { type: "COUNTDOWN_ENDED" }).state.phase).toBe("heard");
  });

  it("stops on Edit and opens the text box", () => {
    const result = transition(counting, { type: "EDIT" });
    expect(result.state).toMatchObject({ phase: "heard", editing: true, countdown: false });
  });

  it("Re-record throws the answer away and listens again", () => {
    const result = transition(counting, { type: "RERECORD" });
    expect(result.state.phase).toBe("listening");
    expect(result.effects).toEqual(["abort-listen", "clear-answer", "arm", "open-mic"]);
  });

  it("Send now sends at once", () => {
    const result = transition(counting, { type: "SUBMIT" });
    expect(result.state.phase).toBe("checking");
    expect(result.effects).toEqual(["abort-listen", "submit"]);
  });

  it("also runs after Done, with no hold", () => {
    const result = transition(at("listening", { closing: true }), { type: "TURN_CLOSED", hasText: true });
    expect(result.state).toMatchObject({ phase: "heard", countdown: true, holding: false });
    expect(result.effects).toEqual(["start-countdown"]);
  });
});

describe("tapping while the voice is talking", () => {
  it("fades the voice and opens the mic", () => {
    const result = transition(at("speaking"), { type: "PRIMARY" });
    expect(result.state.phase).toBe("listening");
    expect(result.effects).toEqual(["fade-speech", "open-mic"]);
  });

  it("does not let a late speech-ended event open the mic twice", () => {
    const { state, effects } = run([{ type: "PRIMARY" }, { type: "SPEECH_ENDED" }], at("speaking"));
    expect(state.phase).toBe("listening");
    expect(effects.filter((effect) => effect === "open-mic")).toHaveLength(1);
  });

  it("can skip a voice that has not started yet", () => {
    const result = transition(at("thinking"), { type: "PRIMARY" });
    expect(result.state.phase).toBe("listening");
    expect(result.effects).toEqual(["stop-speech", "open-mic"]);
  });
});

describe("Done", () => {
  it("asks for the end of the turn only once, however many times it is tapped", () => {
    const first = transition(at("listening"), { type: "PRIMARY" });
    expect(first.state.closing).toBe(true);
    expect(first.effects).toEqual(["finish-turn"]);
    const second = transition(first.state, { type: "PRIMARY" });
    expect(second.effects).toEqual([]);
  });

  it("goes back to your-turn with a note when nothing was heard", () => {
    const result = transition(at("listening", { closing: true }), { type: "TURN_CLOSED", hasText: false });
    expect(result.state.phase).toBe("your-turn");
    expect(result.state.notice).toBe("nothing-heard");
    expect(result.state.closing).toBe(false);
  });
});

describe("falling back to typing", () => {
  it("listens anyway when the spoken question fails, since the question is on screen", () => {
    for (const phase of ["thinking", "speaking"] as const) {
      const result = transition(at(phase), { type: "SPEECH_FAILED" });
      expect(result.state.phase).toBe("listening");
      expect(result.state.notice).toBe("no-spoken-question");
      expect(result.effects).toEqual(["stop-speech", "open-mic"]);
    }
  });

  it("ignores a failed read-aloud of the verdict", () => {
    expect(transition(at("verdict"), { type: "SPEECH_FAILED" }).state.phase).toBe("verdict");
  });

  it("keeps the reason a listen failed", () => {
    for (const reason of ["mic-denied", "token", "socket", "no-transcript"] as const) {
      const result = transition(at("listening"), { type: "LISTEN_FAILED", reason });
      expect(result.state.phase).toBe("type-instead");
      expect(result.state.reason).toBe(reason);
      expect(result.effects).toEqual(["stop-speech", "abort-listen", "notify-type-instead"]);
    }
  });

  it("offers type instead everywhere the learner is still answering", () => {
    for (const phase of ["ready", "thinking", "speaking", "your-turn", "listening", "heard"] as const) {
      const result = transition(at(phase), { type: "TYPE_INSTEAD" });
      expect(result.state.phase).toBe("type-instead");
      expect(result.state.reason).toBe("chosen");
    }
  });

  it("does not leave checking or verdict for typing", () => {
    for (const phase of ["checking", "verdict"] as const) {
      expect(transition(at(phase), { type: "TYPE_INSTEAD" }).state.phase).toBe(phase);
    }
  });

  it("can return to voice", () => {
    const result = transition(at("type-instead", { reason: "socket" }), { type: "RETRY_VOICE" });
    expect(result.state.phase).toBe("your-turn");
    expect(result.state.reason).toBeNull();
  });
});

describe("sending the answer", () => {
  it("Space does not send: it only stops the countdown, through STOP_COUNTDOWN", () => {
    const result = transition(at("heard"), { type: "PRIMARY" });
    expect(result.state.phase).toBe("heard");
    expect(result.effects).toEqual([]);
  });

  it("returns to where it came from with a note if sending fails", () => {
    for (const phase of ["heard", "type-instead"] as const) {
      const { state } = run([{ type: "SUBMIT" }, { type: "SUBMIT_FAILED" }], at(phase));
      expect(state.phase).toBe(phase);
      expect(state.notice).toBe("send-failed");
    }
  });

  it("keeps the heard answer if the held mic fails", () => {
    const result = transition(at("heard", { holding: true, countdown: true }), { type: "LISTEN_FAILED", reason: "socket" });
    expect(result.state).toMatchObject({ phase: "heard", holding: false, countdown: true });
  });

  it("skips the read-aloud when a verdict has no feedback", () => {
    const result = transition(at("checking"), { type: "VERDICT", verdict: { passed: false, feedback: null } });
    expect(result.state.phase).toBe("verdict");
    expect(result.effects).toEqual([]);
  });
});
