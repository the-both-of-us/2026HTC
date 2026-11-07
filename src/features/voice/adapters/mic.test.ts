import { afterEach, describe, expect, it, vi } from "vitest";
import { MicError } from "./types";

vi.mock("./audioEngine", () => ({
  audioContext: () => context,
  createAnalyser: () => ({}),
  analyserMeter: () => ({ read: () => {} }),
}));

const disconnect = vi.fn();
let context = { createMediaStreamSource: vi.fn(() => ({ connect: () => {}, disconnect })) };

function stubBrowser(recorder: new () => unknown) {
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }, { stop }] }) },
  });
  const Recorder = Object.assign(recorder, { isTypeSupported: () => true });
  vi.stubGlobal("MediaRecorder", Recorder);
  return stop;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  context = { createMediaStreamSource: vi.fn(() => ({ connect: () => {}, disconnect })) };
});

async function open() {
  const { openBrowserMic } = await import("./mic");
  return openBrowserMic(() => {});
}

class WorkingRecorder {
  state = "inactive";
  ondataavailable: unknown = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
  requestData() {}
}

describe("openBrowserMic", () => {
  it("turns the mic off if the recorder can't be created", async () => {
    const stop = stubBrowser(
      class {
        constructor() {
          throw new Error("NotSupportedError");
        }
      },
    );
    await expect(open()).rejects.toBeInstanceOf(MicError);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalled();
  });

  it("turns the mic off if the recorder can't start", async () => {
    const stop = stubBrowser(
      class extends WorkingRecorder {
        start() {
          throw new Error("InvalidStateError");
        }
      },
    );
    await expect(open()).rejects.toMatchObject({ reason: "unsupported" });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("turns the mic off if the audio graph can't be built", async () => {
    const stop = stubBrowser(WorkingRecorder);
    context.createMediaStreamSource = vi.fn(() => {
      throw new Error("no audio");
    });
    await expect(open()).rejects.toBeInstanceOf(MicError);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("leaves the mic on when setup works, until it's released", async () => {
    const stop = stubBrowser(WorkingRecorder);
    const mic = await open();
    expect(stop).not.toHaveBeenCalled();
    mic.release();
    mic.release();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
