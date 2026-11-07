/**
 * The AudioWorklet that turns the microphone into what Flux reads best: 16 kHz, 16-bit PCM,
 * in 80 ms pieces. It averages each group of input samples down to one, which is enough
 * filtering for speech. It is a string because a worklet must load from its own URL.
 */
export const PCM_WORKLET_NAME = "oryx-pcm16";

/** 80 ms at 16 kHz, the chunk size Flux's docs recommend. */
export const PCM_CHUNK_SAMPLES = 1_280;

export const PCM_WORKLET_SOURCE = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
    this.out = new Int16Array(${PCM_CHUNK_SAMPLES});
    this.length = 0;
    this.port.onmessage = () => this.send();
  }
  send() {
    if (this.length === 0) return;
    const chunk = this.out.slice(0, this.length);
    this.port.postMessage(chunk.buffer, [chunk.buffer]);
    this.length = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count += 1;
      this.position += 1;
      if (this.position >= this.step) {
        this.position -= this.step;
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.out[this.length++] = sample < 0 ? sample * 32768 : sample * 32767;
        this.sum = 0;
        this.count = 0;
        if (this.length === this.out.length) this.send();
      }
    }
    return true;
  }
}
registerProcessor("${PCM_WORKLET_NAME}", Pcm16);
`;
