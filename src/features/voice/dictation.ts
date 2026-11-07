/**
 * Dictation through Flux, without React, so tests can drive it. Each start() is a fresh
 * recording with its own transcript. Whichever run is current owns the words, and a run
 * that was cancelled or replaced can't deliver anything or touch the one after it.
 */
import { SILENT_METER, type AudioMeter, type ListenDeps } from "./adapters/types";
import { Listener } from "./listener";
import type { FallbackReason } from "./machine";
import { applyTurn, EMPTY_TRANSCRIPT, finalText, fullText, interimText, settle, startTake, type Transcript } from "./transcript";

export type DictationStatus = "idle" | "listening" | "finishing";

export type DictationEvents = {
  onChange(status: DictationStatus, words: { final: string; interim: string }): void;
  /** The finished text, when listening ends normally. */
  onText(text: string): void;
  /** Voice stopped working. Whatever was heard comes along, so nothing is lost. */
  onFallback(reason: FallbackReason, partialText: string): void;
};

type Run = { listener: Listener; transcript: Transcript; finishing: boolean };

const NO_WORDS = { final: "", interim: "" };

export class Dictation {
  private run: Run | null = null;

  constructor(
    private readonly createDeps: () => ListenDeps,
    private readonly events: DictationEvents,
  ) {}

  get meter(): AudioMeter {
    return this.run?.listener.meter ?? SILENT_METER;
  }

  start(): void {
    if (this.run) return;
    const run: Run = {
      transcript: startTake(EMPTY_TRANSCRIPT),
      finishing: false,
      listener: new Listener(this.createDeps(), {
        onTurn: (update) => {
          if (this.run !== run) return;
          run.transcript = applyTurn(run.transcript, update);
          this.events.onChange(run.finishing ? "finishing" : "listening", {
            final: finalText(run.transcript),
            interim: interimText(run.transcript),
          });
        },
        onFailed: (reason) => {
          if (this.run !== run) return;
          this.run = null;
          this.events.onChange("idle", NO_WORDS);
          this.events.onFallback(reason, fullText(run.transcript));
        },
      }),
    };
    this.run = run;
    this.events.onChange("listening", NO_WORDS);
    void run.listener.start();
  }

  /** Ends the recording and delivers its text, unless it was cancelled or failed on the way. */
  async stop(): Promise<void> {
    const run = this.run;
    if (!run || run.finishing) return;
    run.finishing = true;
    this.events.onChange("finishing", { final: finalText(run.transcript), interim: interimText(run.transcript) });
    await run.listener.finish();
    if (this.run !== run) return;
    this.run = null;
    const text = fullText(settle(run.transcript));
    this.events.onChange("idle", NO_WORDS);
    if (text) this.events.onText(text);
  }

  /** Stops at once, and nothing is delivered. Safe to call at any time. */
  cancel(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.listener.abort();
    this.events.onChange("idle", NO_WORDS);
  }
}
