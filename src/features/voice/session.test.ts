/** A whole interview in Node, with fake adapters. Each test is one thing a learner could live through. */
import { describe, expect, it, vi } from "vitest";
import { SILENT_METER, MicError, type ListenDeps, type SocketLike, type SpeechHandlers, type VoiceAdapters } from "./adapters/types";
import { COUNTDOWN_MS, DOUBLE_TAP_MS, HOLD_MS, SUBMIT_TIMEOUT_MS, VoiceSession, type VoiceCallbacks } from "./session";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
    if (data === '{"type":"ForceEndTurn"}') {
      queueMicrotask(() => this.turn("EndOfTurn", this.turnIndex, this.lastText));
    }
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  turnIndex = 0;
  lastText = "";
  private sequence = 0;
  turn(event: string, turnIndex: number, transcript: string) {
    this.turnIndex = turnIndex;
    this.lastText = transcript;
    this.onmessage?.({
      data: JSON.stringify({ type: "TurnInfo", event, turn_index: turnIndex, transcript, sequence_id: ++this.sequence }),
    });
  }
}

function build(over: { callbacks?: Partial<VoiceCallbacks>; listen?: Partial<ListenDeps>; now?: () => number } = {}) {
  let speech: SpeechHandlers | null = null;
  const sockets: FakeSocket[] = [];
  const mics: ((chunk: ArrayBuffer) => void)[] = [];
  const log: string[] = [];
  const adapters: VoiceAdapters = {
    speech: {
      unlock: () => log.push("unlock"),
      prefetch: (kind) => log.push(`prefetch:${kind}`),
      play: (kind, handlers) => {
        log.push(`play:${kind}`);
        speech = handlers;
      },
      fadeOut: () => log.push("fade"),
      stop: () => log.push("stop"),
      position: () => ({ seconds: 0, duration: null }),
      meter: SILENT_METER,
    },
    listen: {
      fetchGrant: async () => ({ token: "t", wsUrl: "wss://x" }),
      openMic: async (onChunk) => {
        log.push("mic-open");
        mics.push(onChunk);
        return { meter: SILENT_METER, flush: () => {}, release: () => log.push("mic-release") };
      },
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      ...over.listen,
    },
    unlockAudio: () => log.push("unlock-audio"),
  };
  const onAnswer = vi.fn(over.callbacks?.onAnswer ?? (async () => ({ passed: true, feedback: "Good." })));
  const onTypeInstead = vi.fn(over.callbacks?.onTypeInstead ?? (() => {}));
  // Unless a test is about double-clicks, every tap is a separate, deliberate one.
  let clock = 0;
  const session = new VoiceSession(adapters, { onAnswer, onTypeInstead }, { now: over.now ?? (() => (clock += 1_000)) });
  return {
    session,
    log,
    sockets,
    onAnswer,
    onTypeInstead,
    speech: () => speech!,
    phase: () => session.getSnapshot().state.phase,
    socket: () => sockets.at(-1)!,
    /** Sends one chunk of loud audio from the newest mic. */
    speak: () => mics.at(-1)!(new Int16Array(4).fill(9_000).buffer),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** One tap, the question plays and ends, and the mic opens by itself. */
async function reachListening(t: ReturnType<typeof build>) {
  t.session.send({ type: "PRIMARY" });
  t.speech().onPlaying();
  t.speech().onEnded();
  await settle();
  t.socket().open();
}

describe("a full interview", () => {
  it("sends exactly the text shown, as voice", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "First part.");
    t.socket().turn("Update", 1, "Second part");
    expect(t.session.getSnapshot().finalText).toBe("First part.");
    expect(t.session.getSnapshot().interimText).toBe("Second part");

    t.session.send({ type: "PRIMARY" });
    await vi.waitFor(() => expect(t.phase()).toBe("heard"), { timeout: 3000 });
    const shown = t.session.getSnapshot().text;
    expect(shown).toBe("First part. Second part");

    t.session.send({ type: "SUBMIT" });
    await vi.waitFor(() => expect(t.phase()).toBe("verdict"));
    expect(t.onAnswer).toHaveBeenCalledWith(shown, "voice");
    expect(t.log).toContain("play:feedback");
  });

  it("counts an edited answer as typed", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "spoken wrod");
    t.session.send({ type: "PRIMARY" });
    await vi.waitFor(() => expect(t.phase()).toBe("heard"), { timeout: 3000 });
    t.session.edit("spoken word");
    t.session.send({ type: "SUBMIT" });
    await vi.waitFor(() => expect(t.onAnswer).toHaveBeenCalledWith("spoken word", "typed"));
  });

  it("Re-record starts over on a new connection", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "Take one.");
    expect(t.phase()).toBe("heard");
    t.session.send({ type: "RERECORD" });
    await settle();
    t.socket().open();
    t.socket().turn("EndOfTurn", 0, "Take two.");
    expect(t.session.getSnapshot().text).toBe("Take two.");
    expect(t.phase()).toBe("heard");
  });

  it("stays in checking when the parent returns no verdict, because the parent takes over", async () => {
    const t = build({ callbacks: { onAnswer: async () => undefined } });
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "words");
    t.session.send({ type: "PRIMARY" });
    await vi.waitFor(() => expect(t.phase()).toBe("heard"), { timeout: 3000 });
    t.session.send({ type: "SUBMIT" });
    await settle();
    expect(t.phase()).toBe("checking");
  });

  it("goes back to review, with the words, if sending fails", async () => {
    const t = build({
      callbacks: {
        onAnswer: async () => {
          throw new Error("network");
        },
      },
    });
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "keep me");
    t.session.send({ type: "PRIMARY" });
    await vi.waitFor(() => expect(t.phase()).toBe("heard"), { timeout: 3000 });
    t.session.send({ type: "SUBMIT" });
    await vi.waitFor(() => expect(t.session.getSnapshot().state.notice).toBe("send-failed"));
    expect(t.phase()).toBe("heard");
    expect(t.session.getSnapshot().text).toBe("keep me");
  });
});

describe("talking over the voice", () => {
  it("fades it out and opens the mic", async () => {
    const t = build();
    t.session.send({ type: "PRIMARY" });
    t.speech().onPlaying();
    t.session.send({ type: "PRIMARY" });
    await settle();
    expect(t.phase()).toBe("listening");
    expect(t.log).toContain("fade");
    expect(t.log).toContain("mic-open");
  });
});

describe("sliding to typing, with words kept", () => {
  it("not on a TTS failure: the question is on screen, so it listens anyway", () => {
    const t = build();
    t.session.send({ type: "PRIMARY" });
    t.speech().onFailed();
    expect(t.phase()).toBe("listening");
    expect(t.session.getSnapshot().state.notice).toBe("no-spoken-question");
    expect(t.onTypeInstead).not.toHaveBeenCalled();
  });

  it("on a token failure", async () => {
    const t = build({
      listen: {
        fetchGrant: async () => {
          throw new Error("503");
        },
      },
    });
    t.session.send({ type: "PRIMARY" });
    await settle();
    expect(t.phase()).toBe("type-instead");
    expect(t.session.getSnapshot().state.reason).toBe("token");
    expect(t.log).toContain("mic-release");
  });

  it("on a dropped socket, keeping what was said", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("Update", 0, "half an answer");
    t.socket().onclose?.({});
    expect(t.phase()).toBe("type-instead");
    expect(t.session.getSnapshot().text).toBe("half an answer");
    expect(t.onTypeInstead).toHaveBeenCalledWith("half an answer");
  });

  it("on a blocked microphone, with its own reason", async () => {
    const t = build({
      listen: {
        openMic: async () => {
          throw new MicError("mic-denied");
        },
      },
    });
    t.session.send({ type: "PRIMARY" });
    t.speech().onFailed();
    t.session.send({ type: "RETRY_VOICE" });
    t.session.send({ type: "PRIMARY" });
    await settle();
    expect(t.session.getSnapshot().state.reason).toBe("mic-denied");
  });

  it("when the learner chooses it, stopping the voice and the mic", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("Update", 0, "started");
    t.session.send({ type: "TYPE_INSTEAD" });
    expect(t.phase()).toBe("type-instead");
    expect(t.log).toContain("mic-release");
    expect(t.onTypeInstead).toHaveBeenCalledWith("started");
  });
});

describe("a double-click is one tap", () => {
  function withClock() {
    const clock = { at: 0 };
    return { clock, t: build({ now: () => clock.at }) };
  }

  it("on Answer aloud: the question still plays", () => {
    const { clock, t } = withClock();
    t.session.send({ type: "PRIMARY" });
    clock.at = DOUBLE_TAP_MS - 1;
    t.session.send({ type: "PRIMARY" });
    expect(t.phase()).toBe("thinking");
    expect(t.log).not.toContain("stop");
  });

  it("on Re-record: the second click doesn't land on Done", async () => {
    const { clock, t } = withClock();
    t.session.send({ type: "PRIMARY" });
    t.speech().onPlaying();
    t.speech().onEnded();
    await settle();
    t.socket().open();
    t.socket().turn("EndOfTurn", 0, "words");
    clock.at = 9_000;
    t.session.send({ type: "RERECORD" });
    clock.at = 9_100;
    t.session.send({ type: "PRIMARY" });
    expect(t.phase()).toBe("listening");
    expect(t.session.getSnapshot().state.closing).toBe(false);
  });

  it("counts the gap from when the first tap finished, because a busy page delays the second", () => {
    const clock = { at: 0 };
    const t = build({
      now: () => clock.at,
      listen: {},
    });
    const play = t.session["adapters"].speech.play;
    t.session["adapters"].speech.play = (kind, handlers) => {
      clock.at = 500;
      play(kind, handlers);
    };
    t.session.send({ type: "PRIMARY" });
    clock.at = 600;
    t.session.send({ type: "PRIMARY" });
    expect(t.phase()).toBe("thinking");
  });

  it("a later tap still counts", () => {
    const { clock, t } = withClock();
    t.session.send({ type: "PRIMARY" });
    clock.at = DOUBLE_TAP_MS;
    t.session.send({ type: "PRIMARY" });
    expect(t.phase()).toBe("listening");
  });
});

describe("tapping quickly through a slow finish", () => {
  it("Done, Type instead, Use voice, Start talking: the old finish can't touch the new take", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("Update", 0, "First take.");
    t.session.send({ type: "PRIMARY" });
    t.session.send({ type: "TYPE_INSTEAD" });
    t.session.send({ type: "RETRY_VOICE" });
    t.session.send({ type: "PRIMARY" });
    await settle();
    t.socket().open();
    const second = t.socket();
    t.socket().turn("Update", 0, "second");

    await new Promise((resolve) => setTimeout(resolve, 2_300));
    expect(t.phase()).toBe("listening");
    expect(t.session.getSnapshot().state.notice).toBeNull();
    expect(second.readyState).toBe(1);
    expect(t.session.getSnapshot().text).toBe("First take. second");
  });
});

describe("when an answer gets no reply", () => {
  async function reachHeard(t: ReturnType<typeof build>) {
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "keep me");
    expect(t.phase()).toBe("heard");
  }

  it("goes back to review with the words, instead of trapping the learner", async () => {
    const t = build({ callbacks: { onAnswer: () => new Promise(() => {}) } });
    await reachHeard(t);
    vi.useFakeTimers();
    try {
      t.session.send({ type: "SUBMIT" });
      await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS - 1);
      expect(t.phase()).toBe("checking");
      await vi.advanceTimersByTimeAsync(1);
      expect(t.phase()).toBe("heard");
      expect(t.session.getSnapshot().state.notice).toBe("send-failed");
      expect(t.session.getSnapshot().text).toBe("keep me");
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits longer than the follow-up route can run, so a slow grade isn't called a failure", () => {
    expect(SUBMIT_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it("ignores a verdict that arrives after giving up", async () => {
    const replies: ((verdict: { passed: boolean; feedback: string }) => void)[] = [];
    const t = build({ callbacks: { onAnswer: () => new Promise((resolve) => replies.push(resolve)) } });
    await reachHeard(t);
    vi.useFakeTimers();
    try {
      t.session.send({ type: "SUBMIT" });
      await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS);
      t.session.send({ type: "SUBMIT" });
      replies[0]({ passed: true, feedback: "Too late." });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.phase()).toBe("checking");
      replies[1]({ passed: true, feedback: "The real one." });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.session.getSnapshot().state.verdict?.feedback).toBe("The real one.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out once the parent has taken over", async () => {
    const t = build({ callbacks: { onAnswer: async () => undefined } });
    await reachHeard(t);
    vi.useFakeTimers();
    try {
      t.session.send({ type: "SUBMIT" });
      await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS * 2);
      expect(t.phase()).toBe("checking");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cleaning up", () => {
  it("dispose releases the mic and stops the voice", async () => {
    const t = build();
    await reachListening(t);
    t.session.dispose();
    expect(t.log).toContain("mic-release");
    expect(t.log).toContain("stop");
  });

  it("stays silent if the verdict arrives after leaving the page", async () => {
    let reply: (verdict: { passed: boolean; feedback: string }) => void = () => {};
    const t = build({ callbacks: { onAnswer: () => new Promise((resolve) => (reply = resolve)) } });
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "words");
    t.session.send({ type: "PRIMARY" });
    await vi.waitFor(() => expect(t.phase()).toBe("heard"), { timeout: 3000 });
    t.session.send({ type: "SUBMIT" });
    t.session.dispose();
    reply({ passed: true, feedback: "Spoken after leaving." });
    await settle();
    expect(t.log).not.toContain("play:feedback");
  });

  it("still works after Strict Mode's mount, dispose, mount", () => {
    const t = build();
    t.session.activate();
    t.session.dispose();
    t.session.activate();
    t.session.send({ type: "PRIMARY" });
    expect(t.phase()).toBe("thinking");
    expect(t.log).toContain("play:question");
  });

  it("starts nothing new once disposed", () => {
    const t = build();
    t.session.dispose();
    t.session.send({ type: "PRIMARY" });
    expect(t.phase()).toBe("ready");
    expect(t.log).not.toContain("play:question");
  });
});

describe("hands-free", () => {
  it("downloads the question before the tap, and opens mic and socket while it plays", async () => {
    const t = build();
    t.session.prefetch();
    expect(t.log).toContain("prefetch:question");
    t.session.send({ type: "PRIMARY" });
    t.speech().onPlaying();
    await settle();
    expect(t.log).toContain("mic-open");
    expect(t.sockets).toHaveLength(1);
  });

  it("sends silence, not the mic, until the question has ended", async () => {
    const t = build();
    t.session.send({ type: "PRIMARY" });
    t.speech().onPlaying();
    await settle();
    t.socket().open();
    t.speak();
    expect(new Int16Array(t.socket().sent.at(-1) as ArrayBuffer).every((sample) => sample === 0)).toBe(true);
    t.speech().onEnded();
    await settle();
    t.speak();
    expect(new Int16Array(t.socket().sent.at(-1) as ArrayBuffer)[0]).toBe(9_000);
  });

  it("shows the answer at Flux's end of turn, and sends it after the countdown", async () => {
    vi.useFakeTimers();
    try {
      const t = build();
      t.session.send({ type: "PRIMARY" });
      t.speech().onPlaying();
      t.speech().onEnded();
      await vi.advanceTimersByTimeAsync(10);
      t.socket().open();
      t.socket().turn("EndOfTurn", 0, "Heat ages the paper.");
      expect(t.phase()).toBe("heard");
      expect(t.session.getSnapshot().countdownEndsAt).not.toBeNull();
      await vi.advanceTimersByTimeAsync(HOLD_MS);
      expect(t.socket().sent).toContain('{"type":"CloseStream"}');
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS - HOLD_MS);
      expect(t.onAnswer).toHaveBeenCalledWith("Heat ages the paper.", "voice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to listening when they keep talking after a pause, and keeps both parts", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "Heat ages the paper.");
    expect(t.phase()).toBe("heard");
    t.socket().turn("Update", 1, "So it fails");
    expect(t.phase()).toBe("listening");
    t.socket().turn("EndOfTurn", 1, "So it fails sooner.");
    expect(t.session.getSnapshot().text).toBe("Heat ages the paper. So it fails sooner.");
  });

  it("a key stops the countdown, and nothing is sent until they choose", async () => {
    vi.useFakeTimers();
    try {
      const t = build();
      t.session.send({ type: "PRIMARY" });
      t.speech().onPlaying();
      t.speech().onEnded();
      await vi.advanceTimersByTimeAsync(10);
      t.socket().open();
      t.socket().turn("EndOfTurn", 0, "words");
      t.session.send({ type: "STOP_COUNTDOWN" });
      await vi.advanceTimersByTimeAsync(COUNTDOWN_MS * 2);
      expect(t.onAnswer).not.toHaveBeenCalled();
      expect(t.phase()).toBe("heard");
    } finally {
      vi.useRealTimers();
    }
  });
});
