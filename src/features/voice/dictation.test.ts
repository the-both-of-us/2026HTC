import { describe, expect, it, vi } from "vitest";
import { MicError, SILENT_METER, type ListenDeps, type MicHandle, type SocketLike } from "./adapters/types";
import { Dictation, type DictationStatus } from "./dictation";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: (string | Blob | ArrayBuffer)[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private sequence = 0;
  private last = { turn: 0, text: "" };
  send(data: string | Blob | ArrayBuffer) {
    this.sent.push(data);
    if (data === '{"type":"ForceEndTurn"}') queueMicrotask(() => this.say("EndOfTurn", this.last.turn, this.last.text));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  say(event: string, turn: number, text: string) {
    this.last = { turn, text };
    this.onmessage?.({ data: JSON.stringify({ type: "TurnInfo", event, turn_index: turn, transcript: text, sequence_id: ++this.sequence }) });
  }
  errorOut() {
    this.onmessage?.({ data: JSON.stringify({ type: "Error", code: "BROKEN", description: "broken" }) });
  }
}

function build(over: Partial<ListenDeps> = {}) {
  const sockets: FakeSocket[] = [];
  const mics: { live: boolean }[] = [];
  const texts: string[] = [];
  const fallbacks: [string, string][] = [];
  const statuses: DictationStatus[] = [];
  const deps: ListenDeps = {
    fetchGrant: async () => ({ token: "t", wsUrl: "wss://x" }),
    openMic: async () => {
      const mic = { live: true };
      mics.push(mic);
      const handle: MicHandle = { meter: SILENT_METER, flush: () => {}, release: () => (mic.live = false) };
      return handle;
    },
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    ...over,
  };
  const dictation = new Dictation(() => deps, {
    onChange: (status) => statuses.push(status),
    onText: (text) => texts.push(text),
    onFallback: (reason, partial) => fallbacks.push([reason, partial]),
  });
  return { dictation, sockets, mics, texts, fallbacks, statuses, socket: () => sockets.at(-1)! };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

async function listening(t: ReturnType<typeof build>) {
  t.dictation.start();
  await tick();
  t.socket().open();
}

describe("Dictation", () => {
  it("delivers the finished text once, and turns the mic off", async () => {
    const t = build();
    await listening(t);
    t.socket().say("EndOfTurn", 0, "First part.");
    t.socket().say("Update", 1, "second part");
    await t.dictation.stop();
    expect(t.texts).toEqual(["First part. second part"]);
    expect(t.mics.every((mic) => !mic.live)).toBe(true);
    expect(t.statuses.at(-1)).toBe("idle");
  });

  it("delivers nothing when nothing was said", async () => {
    const t = build();
    await listening(t);
    await t.dictation.stop();
    expect(t.texts).toEqual([]);
  });

  it("a second Done while finishing doesn't deliver early or twice", async () => {
    const t = build();
    await listening(t);
    t.socket().say("Update", 0, "only once");
    const first = t.dictation.stop();
    await t.dictation.stop();
    expect(t.texts).toEqual([]);
    await first;
    expect(t.texts).toEqual(["only once"]);
  });

  it("Done, cancel, start: the mic stays stoppable and the cancelled text is never delivered", async () => {
    const t = build();
    await listening(t);
    t.socket().say("Update", 0, "cancelled words");
    const stale = t.dictation.stop();
    t.dictation.cancel();
    await listening(t);
    t.socket().say("Update", 0, "new words");
    await stale;
    expect(t.texts).toEqual([]);
    expect(t.statuses.at(-1)).toBe("listening");
    expect(t.mics.at(-1)!.live).toBe(true);

    t.dictation.cancel();
    expect(t.mics.every((mic) => !mic.live)).toBe(true);
    await tick();
    expect(t.texts).toEqual([]);
  });

  it("each recording's text is its own", async () => {
    const t = build();
    await listening(t);
    t.socket().say("Update", 0, "cancelled words");
    t.dictation.cancel();
    await listening(t);
    t.socket().say("EndOfTurn", 0, "kept words");
    await t.dictation.stop();
    expect(t.texts).toEqual(["kept words"]);
  });

  it("cancel during finishing delivers nothing", async () => {
    const t = build();
    await listening(t);
    t.socket().say("Update", 0, "never mind");
    const stopping = t.dictation.stop();
    t.dictation.cancel();
    await stopping;
    expect(t.texts).toEqual([]);
    expect(t.fallbacks).toEqual([]);
  });

  it("an error during finishing falls back once, without also delivering the text", async () => {
    const t = build();
    await listening(t);
    t.socket().say("Update", 0, "half an answer");
    const stopping = t.dictation.stop();
    t.socket().errorOut();
    await stopping;
    expect(t.fallbacks).toEqual([["socket", "half an answer"]]);
    expect(t.texts).toEqual([]);
  });

  it("falls back with what was heard when the connection drops", async () => {
    const t = build();
    await listening(t);
    t.socket().say("Update", 0, "half an answer");
    t.socket().onclose?.({});
    expect(t.fallbacks).toEqual([["socket", "half an answer"]]);
    expect(t.statuses.at(-1)).toBe("idle");
    expect(t.mics.every((mic) => !mic.live)).toBe(true);
  });

  it("falls back when the mic is blocked, and can start again", async () => {
    const openMic = vi
      .fn<ListenDeps["openMic"]>()
      .mockRejectedValueOnce(new MicError("mic-denied"))
      .mockResolvedValue({ meter: SILENT_METER, flush: () => {}, release: () => {} });
    const t = build({ openMic });
    t.dictation.start();
    await tick();
    expect(t.fallbacks).toEqual([["mic-denied", ""]]);
    t.dictation.start();
    await tick();
    expect(t.statuses.at(-1)).toBe("listening");
    t.dictation.cancel();
  });

  it("a second start while listening is ignored", async () => {
    const t = build();
    await listening(t);
    t.dictation.start();
    await tick();
    expect(t.sockets).toHaveLength(1);
    t.dictation.cancel();
  });
});
