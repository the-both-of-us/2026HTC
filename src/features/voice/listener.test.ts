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
      const t = setup({ silent: true }, {
        openMic: async () => ({
          meter: {
            read(frame) {
              frame.level = 0.5;
            },
          },
          flush: () => {},
          release: () => {},
        }),
      });
      await t.listener.start();
      await vi.advanceTimersByTimeAsync(8_250);
      expect(t.failures).toEqual(["no-transcript"]);
    } finally {
      vi.useRealTimers();
    }
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
