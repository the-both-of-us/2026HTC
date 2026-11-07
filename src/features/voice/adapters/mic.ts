/**
 * The microphone. An AudioWorklet turns it into 16 kHz linear16 for Flux, and a separate
 * analyser path feeds the orb and the "are they talking?" check.
 */
import { analyserMeter, audioContext, createAnalyser } from "./audioEngine";
import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "./pcmWorklet";
import { MicError, type MicHandle, type OpenMic } from "./types";

let workletLoaded: Promise<void> | null = null;

/** Loads the worklet once per page. A failed load is tried again next time. */
function loadWorklet(audio: AudioContext): Promise<void> {
  workletLoaded ??= audio.audioWorklet
    .addModule(URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" })))
    .catch((error) => {
      workletLoaded = null;
      throw error;
    });
  return workletLoaded;
}

export const openBrowserMic: OpenMic = async (onChunk) => {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
    throw new MicError("unsupported");
  }

  let stream: MediaStream;
  try {
    // Echo cancellation keeps the question's voice out, if the mic hears the speakers.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("mic-denied");
    if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("mic-missing");
    throw new MicError("unsupported");
  }

  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode;
  let node: AudioWorkletNode;
  try {
    const audio = audioContext();
    await loadWorklet(audio);
    source = audio.createMediaStreamSource(stream);
    analyser = createAnalyser(audio);
    source.connect(analyser);
    // No outputs: it only reads the mic, so nothing reaches the speakers.
    node = new AudioWorkletNode(audio, PCM_WORKLET_NAME, { numberOfOutputs: 0 });
    node.port.onmessage = (event) => onChunk(event.data as ArrayBuffer);
    source.connect(node);
  } catch {
    // The browser already gave us the mic, so its light stays on until these tracks stop.
    source?.disconnect();
    for (const track of stream.getTracks()) track.stop();
    throw new MicError("unsupported");
  }

  const connected = source;
  let released = false;
  const handle: MicHandle = {
    meter: analyserMeter(analyser),
    flush() {
      if (!released) node.port.postMessage("flush");
    },
    release() {
      if (released) return;
      released = true;
      node.port.onmessage = null;
      connected.disconnect();
      for (const track of stream.getTracks()) track.stop();
    },
  };
  return handle;
};
