import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordProved } from "@/features/streaks";
import { startAttempt } from "@/features/teachback";
import type { Attempt } from "@/shared/types";
import { POST } from "./route";

vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(async () => "learner-1") }));
vi.mock("@/features/streaks", () => ({ recordProved: vi.fn() }));
vi.mock("@/features/teachback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/teachback")>()),
  startAttempt: vi.fn(),
}));
const mockStart = vi.mocked(startAttempt);
const mockRecord = vi.mocked(recordProved);

function attempt(status: Attempt["status"]): Attempt {
  return {
    id: "a1",
    mapId: "m1",
    nodeId: "n1",
    ownerId: "learner-1",
    explanation: "Sentence 2: the fix.",
    integrity: { pasted: false, activeMs: 1000, inputMethod: "typed", wordCount: 4 },
    grade: { score: 100, checkpoints: [], misconceptions: [], rejectedQuotes: 0 },
    followUp: null,
    status,
    createdAt: "2026-11-07T10:00:00.000Z",
    format: "catch",
  } as Attempt;
}

function post() {
  return POST(
    new Request("http://test/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mapId: "m1",
        nodeId: "n1",
        explanation: "",
        format: "catch",
        picks: [{ sentence: 2, correction: "Arrays are objects, not a primitive type." }],
        integrity: { pasted: false, activeMs: 1000 },
      }),
    }),
  );
}

beforeEach(() => {
  mockStart.mockReset();
  mockRecord.mockReset();
});

describe("POST /api/attempts", () => {
  it("counts a Catch the mistake pass for the streak, since it has no follow-up", async () => {
    mockStart.mockResolvedValue(attempt("proven"));
    const response = await post();
    expect(response.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledWith("learner-1", { mapId: "m1", nodeId: "n1", attemptId: "a1" });
    expect(await response.json()).not.toHaveProperty("ownerId");
  });

  it("does not count an attempt that still needs its follow-up, or one that failed", async () => {
    mockStart.mockResolvedValue(attempt("needs-followup"));
    await post();
    mockStart.mockResolvedValue(attempt("not-yet"));
    await post();
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
