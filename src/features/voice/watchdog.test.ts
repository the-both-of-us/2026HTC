import { describe, expect, it } from "vitest";
import { LEVEL_UP, NEW_WATCHDOG, NO_TRANSCRIPT_LIMIT_MS, tickWatchdog, type Watchdog } from "./watchdog";

const TICK = 250;

function run(levels: readonly number[], start: Watchdog = NEW_WATCHDOG) {
  let watchdog = start;
  let expired = false;
  for (const level of levels) {
    const result = tickWatchdog(watchdog, { elapsedMs: TICK, level, transcriptChanged: false });
    watchdog = result.watchdog;
    expired ||= result.expired;
  }
  return { watchdog, expired };
}

const repeat = (level: number, ticks: number) => Array<number>(ticks).fill(level);
/** One second of the room, before the learner speaks. */
const room = (level: number) => repeat(level, 4);

describe("tickWatchdog", () => {
  it("expires after 8 s of talking with no words", () => {
    expect(NO_TRANSCRIPT_LIMIT_MS).toBe(8_000);
    expect(run([...room(0.02), ...repeat(0.5, 31)]).expired).toBe(false);
    expect(run([...room(0.02), ...repeat(0.5, 32)]).expired).toBe(true);
  });

  it("does not count silence: thinking before answering is fine", () => {
    expect(run(repeat(0, 400)).expired).toBe(false);
  });

  it("does not count a loud room: it's measured first, and only well above it counts", () => {
    expect(run(repeat(0.2, 400)).expired).toBe(false);
    expect(run([...room(0.2), ...repeat(0.5, 400)]).watchdog.floor).toBe(0.2);
    expect(run([...room(0.2), ...repeat(0.59, 400)]).expired).toBe(false);
    expect(run([...room(0.2), ...repeat(0.61, 32)]).expired).toBe(true);
  });

  it("keeps a floor of its own in a very quiet room", () => {
    expect(run([...room(0.001), ...repeat(LEVEL_UP - 0.01, 400)]).expired).toBe(false);
    expect(run([...room(0.001), ...repeat(LEVEL_UP, 32)]).expired).toBe(true);
  });

  it("takes the room's quietest moment, so a learner who starts talking at once isn't the floor", () => {
    expect(run([0.5, 0.02, 0.5, 0.4]).watchdog.floor).toBe(0.02);
  });

  it("ignores the analyser's empty first reading", () => {
    expect(run([0, 0.1, 0.1, 0.1]).watchdog.floor).toBe(0.1);
  });

  it("counts through the short gaps in real speech", () => {
    const phrase = [0.5, 0.5, 0.5, 0.01, 0.01];
    const eightSeconds = Array.from({ length: 7 }, () => phrase).flat();
    expect(run([...room(0.02), ...eightSeconds]).expired).toBe(true);
  });

  it("starts over after a real pause, so noise that comes and goes never adds up", () => {
    const burst = [...repeat(0.5, 8), ...repeat(0.01, 6)];
    const bursts = Array.from({ length: 30 }, () => burst).flat();
    expect(run([...room(0.02), ...bursts]).expired).toBe(false);
  });

  it("starts over whenever words arrive", () => {
    const { watchdog } = run([...room(0.02), ...repeat(1, 30)]);
    const reset = tickWatchdog(watchdog, { elapsedMs: TICK, level: 1, transcriptChanged: true });
    expect(reset.watchdog.voicedMs).toBe(0);
    expect(reset.expired).toBe(false);
  });
});
