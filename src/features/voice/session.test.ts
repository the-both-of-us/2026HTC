/** A whole interview in Node, with fake adapters. Each test is one thing a learner could live through. */
import { describe, expect, it, vi } from "vitest";
import { SILENT_METER, MicError, type ListenDeps, type SocketLike, type SpeechHandlers, type VoiceAdapters } from "./adapters/types";
import { VoiceSession, type VoiceCallbacks } from "./session";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: (string | Blob | ArrayBuffer)[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string | Blob | ArrayBuffer) {
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

function build(over: { callbacks?: Partial<VoiceCallbacks>; listen?: Partial<ListenDeps> } = {}) {
  let speech: SpeechHandlers | null = null;
  const sockets: FakeSocket[] = [];
  const log: string[] = [];
  const adapters: VoiceAdapters = {
    speech: {
      unlock: () => log.push("unlock"),
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
      openMic: async () => {
        log.push("mic-open");
        return { meter: SILENT_METER, flush: () => {}, release: () => log.push("mic-release") };
      },
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      ...over.listen,
    },
    chime: () => log.push("chime"),
    unlockAudio: () => log.push("unlock-audio"),
  };
  const onAnswer = vi.fn(over.callbacks?.onAnswer ?? (async () => ({ passed: true, feedback: "Good." })));
  const onTypeInstead = vi.fn(over.callbacks?.onTypeInstead ?? (() => {}));
  const session = new VoiceSession(adapters, { onAnswer, onTypeInstead });
  return {
    session,
    log,
    sockets,
    onAnswer,
    onTypeInstead,
    speech: () => speech!,
    phase: () => session.getSnapshot().state.phase,
    socket: () => sockets.at(-1)!,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

async function reachListening(t: ReturnType<typeof build>) {
  t.session.send({ type: "PRIMARY" });
  t.speech().onPlaying();
  t.speech().onEnded();
  t.session.send({ type: "PRIMARY" });
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
    expect(t.log).toContain("chime");
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

  it("adds a second take after the first, even though turn_index restarts", async () => {
    const t = build();
    await reachListening(t);
    t.socket().turn("EndOfTurn", 0, "Take one.");
    t.session.send({ type: "PRIMARY" });
    await vi.waitFor(() => expect(t.phase()).toBe("heard"), { timeout: 3000 });
    t.session.send({ type: "SAY_MORE" });
    await settle();
    t.socket().open();
    t.socket().turn("EndOfTurn", 0, "Take two.");
    expect(t.session.getSnapshot().text).toBe("Take one. Take two.");
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
  it("on a TTS failure", () => {
    const t = build();
    t.session.send({ type: "PRIMARY" });
    t.speech().onFailed();
    expect(t.phase()).toBe("type-instead");
    expect(t.session.getSnapshot().state.reason).toBe("tts");
    expect(t.onTypeInstead).toHaveBeenCalledWith("");
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
    t.speech().onPlaying();
    t.speech().onEnded();
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

describe("cleaning up", () => {
  it("dispose releases the mic and stops the voice", async () => {
    const t = build();
    await reachListening(t);
    t.session.dispose();
    expect(t.log).toContain("mic-release");
    expect(t.log).toContain("stop");
  });
});
