import { describe, expect, it } from "vitest";
import { circleRace } from "./race";

const map = { nodes: [{ id: "a" }, { id: "b" }] } as Parameters<typeof circleRace>[0]["map"];
const member = (name: string, proved: number, isYou = false) => ({ name, proved, isYou });
const proof = (name: string, at: string) => ({ name, nodeId: "a", nodeTitle: "A", at });

describe("circle race", () => {
  const now = new Date("2026-11-11T18:00:00Z"); // Wednesday; the week began Monday Nov 9

  it("ranks this week's proofs and ignores last week's", () => {
    const race = circleRace(
      {
        map,
        members: [member("Sam", 1), member("Ana", 2, true)],
        feed: [proof("Ana", "2026-11-10T18:00:00Z"), proof("Ana", "2026-11-09T18:00:00Z"), proof("Sam", "2026-11-07T18:00:00Z")],
      },
      now,
    );
    expect(race.rows).toEqual([
      { name: "Ana", isYou: true, thisWeek: 2 },
      { name: "Sam", isYou: false, thisWeek: 0 },
    ]);
    expect(race.partial).toBe(false);
  });

  it("names who proved every topic first", () => {
    const race = circleRace(
      {
        map,
        members: [member("Sam", 2), member("Ana", 2), member("Lee", 1)],
        feed: [proof("Sam", "2026-11-11T17:00:00Z"), proof("Ana", "2026-11-10T18:00:00Z")],
      },
      now,
    );
    expect(race.finished).toEqual(["Sam", "Ana"]);
    expect(race.first).toBe("Ana");
  });

  it("doesn't guess the winner when both finishes are older than the feed", () => {
    const race = circleRace({ map, members: [member("Sam", 2), member("Ana", 2)], feed: [] }, now);
    expect(race.first).toBeNull();
    expect(race.finished).toEqual(["Sam", "Ana"]);
  });
});
