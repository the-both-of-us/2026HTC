import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as verify } from "@/app/api/proof/[id]/verify/route";
import { POST } from "@/app/api/proof/route";
import { readUserId } from "@/shared/identity";
import { putDoc } from "@/shared/store";
import type { Attempt, CatchRecord, SkillMap } from "@/shared/types";
import { hashSnapshot, sealFor } from "./hash";
import { getProof } from "./publish";
import { buildSnapshot } from "./snapshot";
import type { LiveProof } from "./types";
import { ProofScreen } from "./ui/ProofScreen";

vi.mock("@/shared/identity", () => ({ readUserId: vi.fn(), getUserId: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "oryx.example", "x-forwarded-proto": "https" }),
}));
const mockUser = vi.mocked(readUserId);

const OWNER = randomUUID();
const WRONG_SENTENCE = "An inner join keeps every row from both tables.";
const WHY = "Planted reason: an inner join drops unmatched rows.";
const CORRECTION = "It keeps only rows that match in both tables.";
const ROUND: CatchRecord = {
  sentences: ["Joins combine tables.", WRONG_SENTENCE, "A left join keeps every left row.", "Keys link the rows."],
  planted: [{ sentence: 2, why: WHY }],
  picks: [
    { sentence: 2, correction: CORRECTION, fixed: true },
    { sentence: 4, correction: "Keys do not link any rows at all.", fixed: false },
  ],
};
const SECRETS = [WRONG_SENTENCE, WHY, CORRECTION, "Keys do not link", "Sentence 2", "sentences"];

let map: SkillMap;
let attempt: Attempt;

beforeEach(async () => {
  mockUser.mockReset();
  map = {
    id: randomUUID(),
    ownerId: OWNER,
    title: "Data Analyst",
    subtitle: "Calgary, AB",
    sourceKind: "topic",
    sourceText: "",
    nodes: [
      { id: "joins", title: "SQL joins", why: "Needed.", prerequisites: [], fromSource: false, citation: null, checkpoints: ["Inner join keeps matches"] },
    ],
    createdAt: "2026-11-07T10:00:00.000Z",
  };
  attempt = {
    id: randomUUID(),
    mapId: map.id,
    nodeId: "joins",
    ownerId: OWNER,
    explanation: `Sentence 2: ${CORRECTION}\nSentence 4: Keys do not link any rows at all.`,
    integrity: { pasted: false, activeMs: 40_000, wordCount: 20, inputMethod: "typed" },
    grade: {
      score: 80,
      checkpoints: [{ checkpoint: "Inner join keeps matches", quote: CORRECTION, met: true }],
      misconceptions: ["Marked sentence 4 as a mistake, but it was correct."],
      rejectedQuotes: 0,
    },
    followUp: null,
    status: "proven",
    createdAt: "2026-11-07T11:00:00.000Z",
    format: "catch",
    catch: ROUND,
  };
  await putDoc(`maps/${map.id}`, map);
  await putDoc(`attempts/${attempt.id}`, attempt);
  await putDoc(`progress/${map.id}/${OWNER}/joins`, { nodeId: "joins", attemptId: attempt.id, provenAt: attempt.createdAt });
});

async function publishNew(): Promise<string> {
  mockUser.mockResolvedValue(OWNER);
  const response = await POST(new Request("http://test/api/proof", { method: "POST", body: JSON.stringify({ mapId: map.id, displayName: "Maya" }) }));
  return (await response.json()).proof.id;
}

/** A record published before the fix: the full round sits in the stored snapshot. */
async function seedLegacy(): Promise<string> {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const snapshot = buildSnapshot({
    proofId: id,
    displayName: "Maya",
    publishedAt: "2026-11-07T12:00:00.000Z",
    map,
    states: { joins: "proven" },
    attempts: { joins: attempt },
  });
  snapshot.skills[0] = {
    ...snapshot.skills[0],
    explanation: attempt.explanation,
    checkpoints: attempt.grade.checkpoints,
    factualErrors: attempt.grade.misconceptions,
    catch: ROUND,
  };
  const hash = hashSnapshot(snapshot);
  const record: LiveProof = { state: "live", id, ownerId: OWNER, mapId: map.id, snapshot, hash, seal: sealFor(hash) };
  await putDoc(`proofs/${id}`, record);
  return id;
}

const asParams = (id: string) => ({ params: Promise.resolve({ id }) });

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
}

describe("a catch round's answers stay off the public evidence", () => {
  it("keeps only counts in a newly published snapshot, and it still verifies", async () => {
    const id = await publishNew();
    const record = await getProof(id);
    expect(record?.state === "live" && record.snapshot.skills[0].catch).toEqual({ plantedCount: 1, caughtCount: 1, wrongTaps: 1 });

    mockUser.mockResolvedValue(null);
    const body = await (await verify(new Request("http://test"), asParams(id))).text();
    expectNoSecrets(body);
    expect(JSON.parse(body)).toMatchObject({ hashMatches: true, scores: { matching: 1, total: 1 }, quotes: { verified: 0, total: 0 } });
    expect(JSON.parse(body).canonical).toBeTypeOf("string");
    expectNoSecrets(renderToStaticMarkup(await ProofScreen({ id })));
  });

  it("hides them for an older record too, whose hash stays valid", async () => {
    const id = await seedLegacy();
    mockUser.mockResolvedValue(null);

    const response = await verify(new Request("http://test"), asParams(id));
    const text = await response.text();
    expectNoSecrets(text);
    expect(JSON.parse(text)).toMatchObject({ hashMatches: true });
    expect(JSON.parse(text)).not.toHaveProperty("canonical");

    const page = renderToStaticMarkup(await ProofScreen({ id }));
    expectNoSecrets(page);
    expect(page).toContain("Caught 1 planted mistake in an AI explanation");
    expect(page).toContain("Caught 1 of 1 planted mistake.");
  });
});
