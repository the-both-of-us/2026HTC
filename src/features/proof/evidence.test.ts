import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { answerFollowUp, startAttempt } from "@/features/teachback";
import { putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { getEvidence } from "./evidence";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

const OWNER = "secret-owner-id";
const EXPLANATION = "An inner join keeps rows found in both tables, and a left join keeps all left rows anyway.";

function node(id: string, prerequisites: string[]): SkillNode {
  return {
    id,
    title: `Title of ${id}`,
    why: "Needed.",
    prerequisites,
    fromSource: true,
    citation: null,
    checkpoints: ["Inner keeps matches", "Left keeps all"],
  };
}

let mapId: string;

beforeEach(async () => {
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();
  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Test map",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "the secret source text",
    nodes: [node("first", []), node("second", ["first"])],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

async function proveFirstSkill() {
  mockChatJSON.mockResolvedValueOnce({
    checkpoints: [
      { number: 1, quote: "keeps rows found in both tables" },
      { number: 2, quote: "keeps all left rows" },
    ],
    factualErrors: [],
  });
  mockChatJSON.mockResolvedValueOnce({ question: "What about a row with no match?" });
  const attempt = await startAttempt(OWNER, {
    mapId,
    nodeId: "first",
    explanation: EXPLANATION,
    integrity: { pasted: false, activeMs: 1000, inputMethod: "typed" },
  });
  mockChatJSON.mockResolvedValueOnce({ passed: true, feedback: "Right." });
  await answerFollowUp(OWNER, attempt.id, "It stays, with NULLs.");
}

describe("getEvidence", () => {
  it("returns null for a map that does not exist", async () => {
    expect(await getEvidence(randomUUID(), null)).toBeNull();
    expect(await getEvidence("../secrets", null)).toBeNull();
  });

  it("lists nothing as proven until a skill is proven", async () => {
    const evidence = await getEvidence(mapId, null);

    expect(evidence?.proven).toEqual([]);
    expect(evidence?.notProven).toEqual(["Title of first", "Title of second"]);
  });

  it("lists a proven skill with the learner's words, and only titles for the rest", async () => {
    await proveFirstSkill();

    const evidence = await getEvidence(mapId, null);

    expect(evidence?.proven.map((skill) => skill.id)).toEqual(["first"]);
    expect(evidence?.proven[0].attempt.explanation).toBe(EXPLANATION);
    expect(evidence?.proven[0].attempt.followUp?.answer).toBe("It stays, with NULLs.");
    expect(evidence?.notProven).toEqual(["Title of second"]);
  });

  it("never holds the owner id or the source text, because anyone can read this", async () => {
    await proveFirstSkill();

    const text = JSON.stringify(await getEvidence(mapId, null));

    expect(text).not.toContain(OWNER);
    expect(text).not.toContain("the secret source text");
  });

  it("knows when the owner is the one looking", async () => {
    expect((await getEvidence(mapId, OWNER))?.viewerIsOwner).toBe(true);
    expect((await getEvidence(mapId, "someone-else"))?.viewerIsOwner).toBe(false);
    expect((await getEvidence(mapId, null))?.viewerIsOwner).toBe(false);
  });
});
