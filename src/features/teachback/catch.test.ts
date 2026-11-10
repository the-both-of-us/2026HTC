import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { putDoc } from "@/shared/store";
import type { IntegritySignals, SkillMap } from "@/shared/types";
import { getCatchView, startAttempt, toLearnerView } from "./attempts";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

const OWNER = "owner-user";
const integrity: Omit<IntegritySignals, "wordCount"> = { pasted: false, activeMs: 20_000, inputMethod: "typed" };

// Sentences 2 and 5 are the planted mistakes.
const SENTENCES = [
  "Plants make their own food.",
  "They do it at night, using moonlight.",
  "The green colour comes from chlorophyll.",
  "They take in carbon dioxide from the air.",
  "They give off nitrogen as waste.",
  "The food they make is a sugar called glucose.",
];

let mapId: string;

function modelWrites() {
  mockChatJSON.mockResolvedValueOnce({
    sentences: SENTENCES,
    mistakes: [
      { sentence: 2, fact: 1, why: "Photosynthesis needs sunlight, so it happens in the day." },
      { sentence: 5, fact: 3, why: "Plants give off oxygen, not nitrogen." },
    ],
  });
}

/** The correction check: which numbered corrections fix their mistake. */
function modelChecks(fixed: number[]) {
  mockChatJSON.mockResolvedValueOnce({ fixed });
}

function play(picks: { sentence: number; correction: string }[]) {
  return startAttempt(OWNER, { mapId, nodeId: "photo", explanation: "", integrity, format: "catch", picks });
}

const GOOD = [
  { sentence: 2, correction: "It happens in daylight using sunlight." },
  { sentence: 5, correction: "They give off oxygen, not nitrogen." },
];

beforeEach(async () => {
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();

  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Plants",
    subtitle: "",
    sourceKind: "topic",
    sourceText: "",
    // The first topic on a map is always "Catch the mistake". Four facts mean two mistakes.
    nodes: [
      {
        id: "photo",
        title: "Photosynthesis",
        why: "How plants eat.",
        prerequisites: [],
        fromSource: false,
        citation: null,
        checkpoints: ["Needs sunlight", "Uses chlorophyll", "Gives off oxygen", "Makes glucose"],
      },
    ],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

describe("Catch the mistake", () => {
  it("sends the sentences and how many are wrong, never which ones", async () => {
    modelWrites();
    const view = await getCatchView(OWNER, mapId, "photo");

    expect(view).toEqual({ sentences: SENTENCES, mistakeCount: 2, revealed: false });
    expect(JSON.stringify(view)).not.toContain("nitrogen, not");
  });

  it("writes the round once and serves it from the store afterwards", async () => {
    modelWrites();
    await getCatchView(OWNER, mapId, "photo");
    await getCatchView(OWNER, mapId, "photo");

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });

  it("proves the topic when both mistakes are found and fixed", async () => {
    modelWrites();
    modelChecks([1, 2]);

    const attempt = await play(GOOD);

    expect(attempt.status).toBe("proven");
    expect(attempt.grade.score).toBe(100);
    expect(attempt.format).toBe("catch");
    expect(attempt.followUp).toBeNull();
    // The reveal comes back only now, after submitting.
    expect(toLearnerView(attempt).catch?.planted.map((item) => item.sentence)).toEqual([2, 5]);
  });

  it("takes 20 points for each correct sentence tapped as wrong", async () => {
    modelWrites();
    modelChecks([1, 2]);

    const attempt = await play([...GOOD, { sentence: 3, correction: "The colour comes from leaves." }]);

    expect(attempt.grade.score).toBe(80);
    expect(attempt.status).toBe("proven");
    expect(attempt.catch?.picks.find((pick) => pick.sentence === 3)?.fixed).toBe(false);
  });

  it("only sends corrections on planted sentences to the AI", async () => {
    modelWrites();
    modelChecks([1]);

    await play([GOOD[0], { sentence: 1, correction: "Plants buy food at shops." }]);

    const checkPrompt = mockChatJSON.mock.calls[1][0].prompt;
    expect(checkPrompt).toContain("daylight");
    expect(checkPrompt).not.toContain("shops");
  });

  it("a correction that does not fix the mistake earns nothing, but half the mistakes fixed still passes", async () => {
    modelWrites();
    modelChecks([1]);

    const attempt = await play(GOOD);

    expect(attempt.grade.score).toBe(50);
    expect(attempt.status).toBe("proven");
  });

  it("counts a missed mistake as unmet", async () => {
    modelWrites();
    modelChecks([1]);

    const attempt = await play([GOOD[0]]);

    expect(attempt.grade.checkpoints.map((result) => result.met)).toEqual([true, false]);
    expect(attempt.grade.score).toBe(50);
  });

  it("can be played once: after the reveal, the learner explains instead", async () => {
    modelWrites();
    modelChecks([1]);
    await play(GOOD);

    await expect(play(GOOD)).rejects.toMatchObject({ status: 409 });
    expect((await getCatchView(OWNER, mapId, "photo")).revealed).toBe(true);
  });

  it("refuses a format the topic doesn't have, but always allows Explain it", async () => {
    await expect(
      startAttempt(OWNER, { mapId, nodeId: "photo", explanation: "x", integrity, format: "kid" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a sentence number that isn't there, and a correction that is too short", async () => {
    modelWrites();
    await expect(play([{ sentence: 9, correction: "This one is wrong." }])).rejects.toMatchObject({ status: 400 });
    await expect(play([{ sentence: 2, correction: "wrong" }])).rejects.toMatchObject({ status: 400 });
  });
});
