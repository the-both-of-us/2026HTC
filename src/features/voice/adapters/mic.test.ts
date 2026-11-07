import { afterEach, describe, expect, it, vi } from "vitest";
import { MicError } from "./types";

vi.mock("./audioEngine", () => ({
  audioContext: () => context,
  createAnalyser: () => ({}),
  analyserMeter: () => ({ read: () => {} }),
}));

const disconnect = vi.fn();
let context: Record<string, unknown>;
const posted: unknown[] = [];

function freshContext() {
  return {
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createMediaStreamSource: vi.fn(() => ({ connect: () => {}, disconnect })),
  };
}
context = freshContext();

class WorkingNode {
  port = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: (data: unknown) => posted.push(data) };
}

function stubBrowser(Node: unknown = WorkingNode) {
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }, { stop }] }) },
  });
  vi.stubGlobal("AudioWorkletNode", Node);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:worklet" }));
  return stop;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  posted.length = 0;
  context = freshContext();
});

async function open(onChunk: (chunk: ArrayBuffer) => void = () => {}) {
  const { openBrowserMic } = await import("./mic");
  return openBrowserMic(onChunk);
}

describe("openBrowserMic", () => {
  it("says unsupported, without asking for the mic, where there is no AudioWorklet", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("AudioWorkletNode", undefined);
    await expect(open()).rejects.toMatchObject({ reason: "unsupported" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("turns the mic off if the worklet can't load", async () => {
    const stop = stubBrowser();
    context.audioWorklet = { addModule: vi.fn(async () => Promise.reject(new Error("blocked"))) };
    await expect(open()).rejects.toBeInstanceOf(MicError);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("turns the mic off if the audio graph can't be built", async () => {
    const stop = stubBrowser(
      class {
        constructor() {
          throw new Error("no audio");
        }
      },
    );
    await expect(open()).rejects.toBeInstanceOf(MicError);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalled();
  });

  it("passes each PCM chunk on, flushes on request, and stops passing them once released", async () => {
    stubBrowser();
    const chunks: ArrayBuffer[] = [];
    const nodes: WorkingNode[] = [];
    vi.stubGlobal(
      "AudioWorkletNode",
      class extends WorkingNode {
        constructor() {
          super();
          nodes.push(this);
        }
      },
    );
    const mic = await open((chunk) => chunks.push(chunk));
    nodes[0].port.onmessage?.({ data: new ArrayBuffer(2_560) });
    expect(chunks).toHaveLength(1);
    mic.flush();
    expect(posted).toEqual(["flush"]);
    mic.release();
    expect(nodes[0].port.onmessage).toBeNull();
  });

  it("leaves the mic on when setup works, until it's released", async () => {
    const stop = stubBrowser();
    const mic = await open();
    expect(stop).not.toHaveBeenCalled();
    mic.release();
    mic.release();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
