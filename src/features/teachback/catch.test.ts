import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, putDoc } from "@/shared/store";
import type { IntegritySignals, SkillMap } from "@/shared/types";
import { getCatchView, startAttempt, toLearnerView } from "./attempts";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);
// A catalog course map reads its syllabus from the catalog; these maps have none yet.
vi.mock("@/features/catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/catalog")>()),
  readCatalogSyllabus: vi.fn(async () => ({ state: "idle" })),
}));

const OWNER = "owner-user";
const integrity: Omit<IntegritySignals, "wordCount" | "inputMethod"> = { pasted: false, activeMs: 20_000 };

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

function play(picks: { sentence: number }[]) {
  return startAttempt(OWNER, { mapId, nodeId: "photo", explanation: "", integrity, format: "catch", picks });
}

const GOOD = [{ sentence: 2 }, { sentence: 5 }];

beforeEach(async () => {
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

  it("proves the topic when both mistakes are tapped, with nothing to write and no AI call", async () => {
    modelWrites();

    const attempt = await play(GOOD);

    expect(attempt.status).toBe("proven");
    expect(attempt.grade.score).toBe(100);
    expect(attempt.format).toBe("catch");
    expect(attempt.followUp).toBeNull();
    // Only the round itself was written by the AI. Checking the taps is code.
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    // A caught mistake's quote is the tapped sentence, which the transcript holds.
    expect(attempt.grade.checkpoints.map((result) => result.quote)).toEqual([SENTENCES[1], SENTENCES[4]]);
    expect(attempt.explanation).toContain(SENTENCES[4]);
    // The reveal comes back only now, after submitting.
    expect(toLearnerView(attempt).catch?.planted.map((item) => item.sentence)).toEqual([2, 5]);
  });

  it("takes 20 points for each correct sentence tapped as wrong", async () => {
    modelWrites();

    const attempt = await play([...GOOD, { sentence: 3 }]);

    expect(attempt.grade.score).toBe(80);
    expect(attempt.status).toBe("proven");
    expect(attempt.catch?.picks.find((pick) => pick.sentence === 3)?.fixed).toBe(false);
  });

  it("half the mistakes caught passes; a missed one is unmet", async () => {
    modelWrites();

    const attempt = await play([GOOD[0]]);

    expect(attempt.grade.checkpoints.map((result) => result.met)).toEqual([true, false]);
    expect(attempt.grade.score).toBe(50);
    expect(attempt.status).toBe("proven");
  });

  it("fails when only correct sentences are tapped", async () => {
    modelWrites();

    const attempt = await play([{ sentence: 1 }]);

    expect(attempt.grade.score).toBe(0);
    expect(attempt.status).toBe("not-yet");
  });

  it("counts a sentence tapped twice once", async () => {
    modelWrites();

    const attempt = await play([GOOD[0], GOOD[0], GOOD[1]]);

    expect(attempt.catch?.picks).toEqual([
      { sentence: 2, fixed: true },
      { sentence: 5, fixed: true },
    ]);
  });

  it("can be played once: after the reveal, the learner explains instead", async () => {
    modelWrites();
    await play(GOOD);

    await expect(play(GOOD)).rejects.toMatchObject({ status: 409 });
    expect((await getCatchView(OWNER, mapId, "photo")).revealed).toBe(true);
  });

  it("refuses a format the topic doesn't have, but always allows Explain it", async () => {
    await expect(
      startAttempt(OWNER, { mapId, nodeId: "photo", explanation: "x", integrity, format: "kid" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a sentence number that isn't there, and no taps at all", async () => {
    modelWrites();
    await expect(play([{ sentence: 9 }])).rejects.toMatchObject({ status: 400 });
    await expect(play([])).rejects.toMatchObject({ status: 400 });
  });
});

describe("a round shared by a catalog course", () => {
  it("is written once for two learners' maps of one course, under the course id, on the write profile", async () => {
    const courseId = randomUUID();
    const source = (await getDoc<SkillMap>(`maps/${mapId}`))!;
    const learner = "second-learner";
    const theirs = randomUUID();
    await putDoc(`maps/${mapId}`, { ...source, courseId });
    await putDoc(`maps/${theirs}`, { ...source, id: theirs, ownerId: learner, courseId });
    modelWrites();

    const mine = await getCatchView(OWNER, mapId, "photo");
    const other = await getCatchView(learner, theirs, "photo");

    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ profile: "write", label: "teachback-catch-write", maxTokens: 6_000 });
    expect(other.sentences).toEqual(mine.sentences);
    expect(await getDoc(`catch/${courseId}/photo`)).not.toBeNull();
    expect(await getDoc(`catch/${mapId}/photo`)).toBeNull();
  });
});
