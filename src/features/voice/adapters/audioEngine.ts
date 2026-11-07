/**
 * The page's one AudioContext, and the meters built on it that read a real signal for the orb.
 */
import { METER_BANDS, type AudioMeter, type MeterFrame } from "./types";

let context: AudioContext | null = null;

export function audioContext(): AudioContext {
  context ??= new AudioContext({ latencyHint: "interactive" });
  return context;
}

/** Browsers start audio suspended until a tap. Call this during one. */
export function resumeAudio(): void {
  const audio = audioContext();
  if (audio.state === "suspended") void audio.resume();
}

/** The bins of a 1024-point FFT at about 48 kHz that hold speech, spaced like hearing is. */
function bandEdges(binCount: number, sampleRate: number): number[] {
  const low = 90;
  const high = 7_000;
  const hzPerBin = sampleRate / 2 / binCount;
  return Array.from({ length: METER_BANDS + 1 }, (_, i) => {
    const hz = low * Math.pow(high / low, i / METER_BANDS);
    return Math.min(binCount - 1, Math.max(1, Math.round(hz / hzPerBin)));
  });
}

/** Reads a real AnalyserNode. Quiet sources are lifted so a mic moves the orb as much as the voice. */
export function analyserMeter(analyser: AnalyserNode): AudioMeter {
  const frequency = new Uint8Array(analyser.frequencyBinCount);
  const wave = new Float32Array(analyser.fftSize);
  const edges = bandEdges(analyser.frequencyBinCount, analyser.context.sampleRate);
  return {
    read(frame: MeterFrame) {
      analyser.getByteFrequencyData(frequency);
      analyser.getFloatTimeDomainData(wave);
      let sum = 0;
      for (const sample of wave) sum += sample * sample;
      frame.level = Math.min(1, Math.sqrt(sum / wave.length) * 4);
      for (let band = 0; band < METER_BANDS; band++) {
        const from = edges[band];
        const to = Math.max(from + 1, edges[band + 1]);
        let peak = 0;
        for (let bin = from; bin < to; bin++) peak = Math.max(peak, frequency[bin]);
        frame.bands[band] = peak / 255;
      }
    },
  };
}

export function createAnalyser(audio: AudioContext): AnalyserNode {
  const analyser = audio.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.72;
  return analyser;
}
