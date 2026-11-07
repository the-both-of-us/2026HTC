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
  it("walks from ready to verdict, opening the mic only after a tap", () => {
    const { state, effects } = run([
      { type: "PRIMARY" },
      { type: "SPEECH_PLAYING" },
      { type: "SPEECH_ENDED" },
      { type: "PRIMARY" },
      { type: "PRIMARY" },
      { type: "TURN_CLOSED", hasText: true },
      { type: "SUBMIT" },
      { type: "VERDICT", verdict: { passed: true, feedback: "Good." } },
    ]);
    expect(state.phase).toBe("verdict");
    expect(effects).toEqual([
      "play-question",
      "prepare-listen",
      "chime",
      "prepare-listen",
      "open-mic",
      "finish-turn",
      "submit",
      "play-feedback",
    ]);
  });

  it("never opens the mic just because the voice stopped: there is no open mic", () => {
    const { state, effects } = run([{ type: "PRIMARY" }, { type: "SPEECH_PLAYING" }, { type: "SPEECH_ENDED" }]);
    expect(state.phase).toBe("your-turn");
    expect(effects).not.toContain("open-mic");
  });
});

describe("tapping while the voice is talking", () => {
  it("fades the voice and opens the mic", () => {
    const result = transition(at("speaking"), { type: "PRIMARY" });
    expect(result.state.phase).toBe("listening");
    expect(result.effects).toEqual(["fade-speech", "open-mic"]);
  });

  it("does not let a late speech-ended event pull the learner out of listening", () => {
    const { state, effects } = run([{ type: "PRIMARY" }, { type: "SPEECH_ENDED" }], at("speaking"));
    expect(state.phase).toBe("listening");
    expect(effects).not.toContain("chime");
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
  it("handles a failure of the voice", () => {
    for (const phase of ["thinking", "speaking"] as const) {
      const result = transition(at(phase), { type: "SPEECH_FAILED" });
      expect(result.state.phase).toBe("type-instead");
      expect(result.state.reason).toBe("tts");
      expect(result.effects).toContain("notify-type-instead");
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
      expect(result.effects).toEqual(["abort-listen", "notify-type-instead"]);
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
  it("never sends on Space: sending is always deliberate", () => {
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

  it("can add more speech to what was heard", () => {
    const result = transition(at("heard"), { type: "SAY_MORE" });
    expect(result.state.phase).toBe("listening");
    expect(result.effects).toEqual(["open-mic"]);
  });

  it("skips the read-aloud when a verdict has no feedback", () => {
    const result = transition(at("checking"), { type: "VERDICT", verdict: { passed: false, feedback: null } });
    expect(result.state.phase).toBe("verdict");
    expect(result.effects).toEqual([]);
  });
});
