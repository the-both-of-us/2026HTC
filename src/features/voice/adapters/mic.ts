/**
 * The microphone. MediaRecorder gives WebM/Opus chunks that go straight to Flux, and
 * a separate analyser path feeds the orb and the "are they talking?" check.
 */
import { analyserMeter, audioContext, createAnalyser } from "./audioEngine";
import { MicError, type MicHandle, type OpenMic } from "./types";

/** Flux reads these containers without being told the encoding. Safari may need Ogg. */
const FORMATS = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"];
const CHUNK_MS = 100;

export const openBrowserMic: OpenMic = async (onChunk) => {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new MicError("unsupported");
  }
  const mimeType = FORMATS.find((format) => MediaRecorder.isTypeSupported(format));
  if (!mimeType) throw new MicError("unsupported");

  let stream: MediaStream;
  try {
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
  let recorder: MediaRecorder;
  try {
    const audio = audioContext();
    source = audio.createMediaStreamSource(stream);
    analyser = createAnalyser(audio);
    source.connect(analyser);
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) onChunk(event.data);
    };
    recorder.start(CHUNK_MS);
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
      if (recorder.state === "recording") recorder.requestData();
    },
    release() {
      if (released) return;
      released = true;
      if (recorder.state !== "inactive") recorder.stop();
      connected.disconnect();
      for (const track of stream.getTracks()) track.stop();
    },
  };
  return handle;
};
