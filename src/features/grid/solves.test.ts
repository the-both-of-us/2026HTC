import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGridSolves, recordSolve, sealReading, type SolveInput } from "./solves";
import { parseCurrentSupplyDemand } from "./parse";
import type { GridReading } from "./types";

const snapshot = parseCurrentSupplyDemand(
  readFileSync(fileURLToPath(new URL("./fixtures/csd-2026-11-07-1316.html", import.meta.url)), "utf8"),
);
const AS_OF = Date.parse(snapshot.asOf);

/** What the browser gets from GET /api/grid and sends back: the reading has been through JSON. */
function served(): Extract<GridReading, { seal?: string }> {
  const reading = sealReading({ status: "live", snapshot, fetchedAt: new Date(AS_OF + 30_000).toISOString() });
  return JSON.parse(JSON.stringify(reading));
}

function input(exerciseId: string, answer: string, reading = served()): SolveInput {
  return { exerciseId, answer, reading: { fetchedAt: reading.fetchedAt, seal: reading.seal ?? "", snapshot: reading.snapshot } };
}

describe("recordSolve", () => {
  it("saves a correct answer with the reading's time and the working", async () => {
    const user = randomUUID();
    // Fixture: dispatched 510 MW, required 479 MW.
    const solve = await recordSolve(user, input("reserve-margin", "31"), AS_OF + 60_000);

    expect(solve).toMatchObject({
      exerciseId: "reserve-margin",
      skill: "the reserve margin",
      asOfLabel: snapshot.asOfLabel,
      answer: "31 MW",
      stale: false,
    });
    expect(solve.working[0]).toContain("510 − 479");
    expect(await listGridSolves(user)).toEqual([solve]);
  });

  it("marks a solve on a report over 15 minutes old as stale", async () => {
    const solve = await recordSolve(randomUUID(), input("reserve-margin", "31"), AS_OF + 20 * 60_000);
    expect(solve.stale).toBe(true);
  });

  it("saves nothing for a wrong answer", async () => {
    const user = randomUUID();
    await expect(recordSolve(user, input("reserve-margin", "40"))).rejects.toMatchObject({ status: 422 });
    expect(await listGridSolves(user)).toEqual([]);
  });

  it("refuses figures the server did not sign", async () => {
    const reading = served();
    const edited = { ...reading, snapshot: { ...reading.snapshot, reserveDispatched: 600 } };
    await expect(recordSolve(randomUUID(), input("reserve-margin", "121", edited))).rejects.toMatchObject({ status: 400 });
    await expect(recordSolve(randomUUID(), { ...input("reserve-margin", "31"), reading: { ...input("x", "").reading, seal: "nope" } })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps one solve per question, the newest", async () => {
    const user = randomUUID();
    await recordSolve(user, input("reserve-margin", "31"), AS_OF + 60_000);
    await recordSolve(user, input("reserve-margin", "31 MW"), AS_OF + 120_000);
    const solves = await listGridSolves(user);
    expect(solves).toHaveLength(1);
    expect(solves[0].solvedAt).toBe(new Date(AS_OF + 120_000).toISOString());
  });
});
