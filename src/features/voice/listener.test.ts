/**
 * The real Listener over a real WebSocket, against a local server that follows Flux's
 * documented protocol. The mic is fake. This cannot prove real Deepgram behaves the
 * same: dev/realCheck.ts does that once keys exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MicError, SILENT_METER, type ListenDeps, type MicHandle, type SocketLike } from "./adapters/types";
import { startFakeProviders, type FakeFluxBehaviour, type FakeProviders } from "./dev/fakeProviders";
import { Listener } from "./listener";
import type { FallbackReason } from "./machine";
import { applyTurn, EMPTY_TRANSCRIPT, finalText, fullText, settle, type Transcript } from "./transcript";

let fake: FakeProviders;
const TAIL_WAIT = 20;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check: () => boolean, ms = 2_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await wait(10);
  }
}

function setup(behaviour: FakeFluxBehaviour, over: Partial<ListenDeps> = {}) {
  fake.flux = behaviour;
  const failures: FallbackReason[] = [];
  let transcript: Transcript = EMPTY_TRANSCRIPT;
  let released = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const openMic: ListenDeps["openMic"] = async (onChunk) => {
    let n = 0;
    timer = setInterval(() => onChunk(new Uint8Array([n++ & 0xff, 1, 2, 3]).buffer), 10);
    const handle: MicHandle = {
      meter: SILENT_METER,
      flush: () => {},
      release: () => {
        released += 1;
        if (timer) clearInterval(timer);
      },
    };
    return handle;
  };

  const deps: ListenDeps = {
    fetchGrant: async () => ({
      token: "fake-jwt-token",
      wsUrl: `ws://127.0.0.1:${fake.port}/v2/listen?model=flux-general-en&keyterm=SCADA`,
    }),
    openMic,
    createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
    ...over,
  };
  const listener = new Listener(deps, {
    onTurn: (update) => {
      transcript = applyTurn(transcript, update);
    },
    onFailed: (reason) => failures.push(reason),
  });
  return {
    listener,
    failures,
    text: () => fullText(transcript),
    settled: () => finalText(settle(transcript)),
    released: () => released,
    log: () => fake.logs.at(-1)!,
    stopMic: () => timer && clearInterval(timer),
  };
}

beforeEach(async () => {
  fake = await startFakeProviders({});
});
afterEach(async () => {
  await fake.close();
});

describe("listening", () => {
  it("authenticates with the bearer subprotocol and sends the first audio first", async () => {
    const t = setup({ script: "hello there", framesPerWord: 2 });
    await t.listener.start();
    await until(() => (fake.logs.at(-1)?.audioFrames ?? 0) > 3);
    expect(t.log().protocols.startsWith("bearer")).toBe(true);
    expect(t.log().url).toContain("keyterm=SCADA");
    // Audio from before the socket opened was queued, not lost: WebM's header is in chunk 0.
    expect(t.log().firstAudioByte).toBe(0);
    t.listener.abort();
  });

  it("reports words as they arrive, and joins turns split by a pause", async () => {
    const t = setup({ script: "one two three four five", splitAfterWords: 2, framesPerWord: 2 });
    await t.listener.start();
    await until(() => t.text().includes("five"));
    await t.listener.finish();
    expect(t.settled()).toBe("one two three four five");
    expect(t.failures).toEqual([]);
  });
});

describe("Done", () => {
  it("sends ForceEndTurn then CloseStream, in that order, and releases the mic", async () => {
    const t = setup({ script: "final words here", framesPerWord: 1 });
    await t.listener.start();
    await until(() => t.text().includes("here"));
    await t.listener.finish();
    expect(t.log().textFrames).toEqual(['{"type":"ForceEndTurn"}', '{"type":"CloseStream"}']);
    expect(t.released()).toBe(1);
    expect(t.failures).toEqual([]);
  });

  it("treats the no-active-turn Warning as finished, without waiting for the cap", async () => {
    const t = setup({ script: "" });
    await t.listener.start();
    await until(() => (fake.logs.at(-1)?.audioFrames ?? 0) > 1);
    const startedAt = Date.now();
    await t.listener.finish();
    expect(Date.now() - startedAt).toBeLessThan(1_200);
    expect(t.failures).toEqual([]);
  });

  it("gives up waiting for EndOfTurn at 1.5 s and keeps the latest words", async () => {
    const t = setup({ script: "kept words", framesPerWord: 1, ignoreForceEndTurn: true });
    await t.listener.start();
    await until(() => t.text().includes("words"));
    const startedAt = Date.now();
    await t.listener.finish();
    const took = Date.now() - startedAt;
    expect(took).toBeGreaterThanOrEqual(1_700);
    expect(took).toBeLessThan(2_700);
    expect(t.settled()).toBe("kept words");
    expect(t.log().textFrames.at(-1)).toBe('{"type":"CloseStream"}');
  });
});

describe("Done before the connection is up", () => {
  it("waits for it, so words already spoken still get through", async () => {
    const t = setup({ script: "quick answer", framesPerWord: 1 });
    const started = t.listener.start();
    const finished = t.listener.finish();
    await started;
    await finished;
    expect(t.log().textFrames[0]).toBe('{"type":"ForceEndTurn"}');
    expect(t.failures).toEqual([]);
  });

  it("does not wait forever when a permission prompt is never answered", async () => {
    vi.useFakeTimers();
    try {
      const t = setup({}, { openMic: () => new Promise(() => {}) });
      void t.listener.start();
      let finished = false;
      void t.listener.finish().then(() => (finished = true));
      await vi.advanceTimersByTimeAsync(5_001);
      expect(finished).toBe(true);
      expect(t.failures).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("failures", () => {
  it("reports a dropped connection", async () => {
    const t = setup({ script: "partial words", framesPerWord: 1, dropAfterFrames: 6 });
    await t.listener.start();
    await until(() => t.failures.length > 0);
    expect(t.failures).toEqual(["socket"]);
    expect(t.released()).toBe(1);
    expect(t.text()).toContain("partial");
  });

  it("reports a refused connection", async () => {
    const t = setup({ refuse: true });
    await t.listener.start();
    await until(() => t.failures.length > 0);
    expect(t.failures).toEqual(["socket"]);
  });

  it("reports a failed token", async () => {
    const t = setup({}, {
      fetchGrant: async () => {
        throw new Error("503");
      },
    });
    await t.listener.start();
    expect(t.failures).toEqual(["token"]);
    expect(t.released()).toBe(1);
  });

  it("reports a blocked microphone", async () => {
    const t = setup({}, {
      openMic: async () => {
        throw new MicError("mic-denied");
      },
    });
    await t.listener.start();
    expect(t.failures).toEqual(["mic-denied"]);
  });

  it("reports silence from the service while the mic is hearing speech", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let reads = 0;
      const t = setup({ silent: true }, {
        openMic: async () => ({
          meter: {
            read(frame) {
              // A second of quiet room, then someone talking.
              frame.level = reads++ < 4 ? 0.02 : 0.5;
            },
          },
          flush: () => {},
          release: () => {},
        }),
      });
      await t.listener.start();
      await vi.advanceTimersByTimeAsync(9_250);
      expect(t.failures).toEqual(["no-transcript"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask for the microphone when the token is already known to have failed", async () => {
    const openMic = vi.fn<ListenDeps["openMic"]>();
    const t = setup({}, {
      fetchGrant: async () => {
        throw new Error("503");
      },
      openMic,
    });
    t.listener.prepare();
    await wait(1);
    await t.listener.start();
    expect(t.failures).toEqual(["token"]);
    expect(openMic).not.toHaveBeenCalled();
  });

  it("tries for a new token the next time, after one failed", async () => {
    let fails = 1;
    const fetchGrant = vi.fn(async () => {
      if (fails-- > 0) throw new Error("503");
      return { token: "fake-jwt-token", wsUrl: `ws://127.0.0.1:${fake.port}/v2/listen` };
    });
    const t = setup({ script: "back again", framesPerWord: 1 }, { fetchGrant });
    t.listener.prepare();
    await wait(1);
    await t.listener.start();
    expect(t.failures).toEqual(["token"]);
    await t.listener.start();
    await until(() => t.text().includes("back"));
    expect(t.failures).toEqual(["token"]);
    t.listener.abort();
  });
});

describe("cleaning up", () => {
  it("abort stops everything and stays quiet", async () => {
    const t = setup({ script: "x y z", framesPerWord: 1 });
    await t.listener.start();
    t.listener.abort();
    t.listener.abort();
    await wait(30);
    expect(t.failures).toEqual([]);
    expect(t.released()).toBe(1);
  });

  it("can run again after finishing", async () => {
    const t = setup({ script: "again", framesPerWord: 1 });
    await t.listener.start();
    await until(() => t.text().includes("again"));
    await t.listener.finish();
    await t.listener.start();
    await until(() => fake.logs.length === 2);
    t.listener.abort();
  });
});

describe("tapping quickly", () => {
  function controlledMics() {
    const log: string[] = [];
    const chunks: ((chunk: ArrayBuffer) => void)[] = [];
    const resolvers: ((handle: MicHandle) => void)[] = [];
    const handle = (name: string): MicHandle => ({ meter: SILENT_METER, flush: () => {}, release: () => log.push(`release:${name}`) });
    const openMic: ListenDeps["openMic"] = (onChunk) => {
      chunks.push(onChunk as (chunk: ArrayBuffer) => void);
      return new Promise((resolve) => resolvers.push(resolve));
    };
    return { log, chunks, resolvers, handle, openMic };
  }

  it("a prompt answered after a restart releases the old mic and opens one socket", async () => {
    const mics = controlledMics();
    const sockets: SocketLike[] = [];
    const t = setup({ script: "hello", framesPerWord: 1 }, {
      openMic: mics.openMic,
      createSocket: (url, protocols) => {
        const socket = new WebSocket(url, protocols) as unknown as SocketLike;
        sockets.push(socket);
        return socket;
      },
    });
    void t.listener.start();
    t.listener.abort();
    void t.listener.start();
    mics.resolvers[0](mics.handle("A"));
    mics.resolvers[1](mics.handle("B"));
    await wait(20);
    expect(mics.log).toEqual(["release:A"]);
    expect(sockets).toHaveLength(1);
    t.listener.abort();
    expect(mics.log).toEqual(["release:A", "release:B"]);
  });

  it("audio from the abandoned mic never joins the new take", async () => {
    const mics = controlledMics();
    const t = setup({ silent: true }, { openMic: mics.openMic });
    void t.listener.start();
    t.listener.abort();
    void t.listener.start();
    mics.chunks[0](new Uint8Array([0xaa]).buffer);
    mics.chunks[1](new Uint8Array([0x1a]).buffer);
    mics.resolvers[0](mics.handle("A"));
    mics.resolvers[1](mics.handle("B"));
    await until(() => fake.logs.at(-1)?.firstAudioByte !== null && fake.logs.at(-1)?.firstAudioByte !== undefined);
    expect(fake.logs.at(-1)!.firstAudioByte).toBe(0x1a);
    t.listener.abort();
  });

  it("a mic that opens after the only take was stopped is released", async () => {
    const mics = controlledMics();
    const t = setup({}, { openMic: mics.openMic });
    void t.listener.start();
    t.listener.abort();
    mics.resolvers[0](mics.handle("A"));
    await wait(5);
    expect(mics.log).toEqual(["release:A"]);
  });

  it("a stale finish leaves the new take running", async () => {
    const t = setup({ script: "one two three", framesPerWord: 1 });
    await t.listener.start();
    await until(() => t.text().includes("one"));
    const staleFinish = t.listener.finish();
    t.listener.abort();
    await t.listener.start();
    await until(() => fake.logs.length === 2 && (fake.logs[1].audioFrames ?? 0) > 0);
    await staleFinish;
    await wait(TAIL_WAIT);
    expect(t.failures).toEqual([]);
    const framesBefore = fake.logs[1].audioFrames;
    await wait(40);
    expect(fake.logs[1].audioFrames).toBeGreaterThan(framesBefore);
    expect(fake.logs[1].textFrames).toEqual([]);
    t.listener.abort();
  });

  it("runs one watchdog at a time", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const t = setup({ silent: true });
      await t.listener.start();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const running = vi.getTimerCount();
      t.listener.abort();
      await t.listener.start();
      expect(vi.getTimerCount()).toBe(running);
      t.listener.abort();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a slow permission prompt", () => {
  it("gets a new token when the prefetched one is nearly dead by the time the mic opens", async () => {
    const realNow = Date.now;
    let skew = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    try {
      let minted = 0;
      const tokens: string[] = [];
      let answerPrompt: (handle: MicHandle) => void = () => {};
      const t = setup({ script: "", silent: true }, {
        fetchGrant: async () => ({ token: `token-${++minted}`, wsUrl: `ws://127.0.0.1:${fake.port}/v2/listen` }),
        openMic: () => new Promise((resolve) => (answerPrompt = resolve)),
        createSocket: (url, protocols) => {
          tokens.push(protocols[1]);
          return new WebSocket(url, protocols) as unknown as SocketLike;
        },
      });
      t.listener.prepare();
      skew = 15_000;
      const started = t.listener.start();
      skew = 30_000;
      answerPrompt({ meter: SILENT_METER, flush: () => {}, release: () => {} });
      await started;
      expect(tokens).toEqual(["token-2"]);
      t.listener.abort();
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps the prefetched token when it is still good", async () => {
    let minted = 0;
    const tokens: string[] = [];
    const t = setup({ silent: true }, {
      fetchGrant: async () => ({ token: `token-${++minted}`, wsUrl: `ws://127.0.0.1:${fake.port}/v2/listen` }),
      createSocket: (url, protocols) => {
        tokens.push(protocols[1]);
        return new WebSocket(url, protocols) as unknown as SocketLike;
      },
    });
    t.listener.prepare();
    await t.listener.start();
    expect(tokens).toEqual(["token-1"]);
    t.listener.abort();
  });
});

describe("the fake speech service", () => {
  it("lets a grant through only with the bearer protocol", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${fake.port}/v2/listen`, ["token", "fake-jwt-token"]);
    const outcome = await new Promise<string>((resolve) => {
      socket.onopen = () => resolve("open");
      socket.onerror = () => resolve("refused");
    });
    expect(outcome).toBe("refused");
  });
});
