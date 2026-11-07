import { describe, expect, it } from "vitest";
import { LEVEL_UP, NEW_WATCHDOG, NO_TRANSCRIPT_LIMIT_MS, tickWatchdog, type Watchdog } from "./watchdog";

function run(ticks: number, level: number, start: Watchdog = NEW_WATCHDOG) {
  let watchdog = start;
  let expired = false;
  for (let i = 0; i < ticks; i++) {
    const result = tickWatchdog(watchdog, { elapsedMs: 250, level, transcriptChanged: false });
    watchdog = result.watchdog;
    expired = result.expired;
  }
  return { watchdog, expired };
}

describe("tickWatchdog", () => {
  it("expires after 8 s of mic level with no words", () => {
    expect(NO_TRANSCRIPT_LIMIT_MS).toBe(8_000);
    expect(run(31, LEVEL_UP).expired).toBe(false);
    expect(run(32, LEVEL_UP).expired).toBe(true);
  });

  it("does not count silence: thinking before answering is fine", () => {
    expect(run(400, 0).expired).toBe(false);
  });

  it("starts over whenever words arrive", () => {
    const { watchdog } = run(30, 1);
    const reset = tickWatchdog(watchdog, { elapsedMs: 250, level: 1, transcriptChanged: true });
    expect(reset.watchdog.voicedMs).toBe(0);
    expect(reset.expired).toBe(false);
  });
});
