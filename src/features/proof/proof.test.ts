import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveNodeStates } from "@/features/skill-map";
import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import type { GridSolve } from "@/features/grid";
import type { Attempt, SkillMap, SkillNode } from "@/shared/types";
import { canonicalJson, checkSnapshot, hashSnapshot, sealFor } from "./hash";
import {
  cleanDisplayName,
  getOwnProofForMap,
  getProof,
  ProofError,
  publishProof,
  revokeProof,
  toOwnerView,
} from "./publish";
import { attemptProvesNode, buildSnapshot } from "./snapshot";
import type { LiveProof } from "./types";

const OWNER = "owner-user-secret-id";
const EXPLANATION =
  "An inner join keeps only rows that match in both tables, while a left join keeps every left row and fills the rest with NULL.";

function makeNode(id: string, prerequisites: string[] = []): SkillNode {
  return {
    id,
    title: `Skill ${id}`,
    why: "Needed for the job.",
    prerequisites,
    fromSource: true,
    citation: { kind: "posting", quote: "Strong SQL required", verified: true },
    checkpoints: ["Inner join keeps only matches", "Left join keeps every left row"],
  };
}

function makeMap(): SkillMap {
  return {
    id: randomUUID(),
    ownerId: OWNER,
    title: "Data Analyst",
    subtitle: "Calgary, AB",
    sourceKind: "posting",
    sourceText: "PRIVATE POSTING TEXT. Strong SQL required.",
    nodes: [makeNode("joins"), makeNode("windows", ["joins"])],
    createdAt: "2026-11-07T10:00:00.000Z",
  };
}

function makeAttempt(map: SkillMap, nodeId: string, overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: randomUUID(),
    mapId: map.id,
    nodeId,
    ownerId: OWNER,
    explanation: EXPLANATION,
    integrity: { pasted: false, activeMs: 42_000, wordCount: 24, inputMethod: "typed" },
    grade: {
      score: 100,
      checkpoints: [
        { checkpoint: "Inner join keeps only matches", quote: "keeps only rows that match in both tables", met: true },
        { checkpoint: "Left join keeps every left row", quote: "keeps every left row", met: true },
      ],
      misconceptions: [],
      rejectedQuotes: 0,
    },
    followUp: { question: "What happens to a row with no match?", answer: "It gets NULLs.", passed: true, feedback: "Right." },
    status: "proven",
    createdAt: "2026-11-07T11:00:00.000Z",
    ...overrides,
  };
}

/** Saves a map where the first skill is proven by a real attempt. */
async function seedProvenMap(): Promise<{ map: SkillMap; attempt: Attempt }> {
  const map = makeMap();
  const attempt = makeAttempt(map, "joins");
  await putDoc(`maps/${map.id}`, map);
  await putDoc(`attempts/${attempt.id}`, attempt);
  await markProven(map, "joins", attempt.id);
  return { map, attempt };
}

/** The store holds one progress document per proven node. */
function markProven(map: SkillMap, nodeId: string, attemptId: string) {
  return putDoc(`progress/${map.id}/${OWNER}/${nodeId}`, { nodeId, attemptId, provenAt: "2026-11-07T11:00:00.000Z" });
}

function snapshotInput(map: SkillMap, attempt: Attempt) {
  return {
    proofId: "abcdefghijklmnop",
    displayName: "Maya Chen",
    publishedAt: "2026-11-07T12:00:00.000Z",
    map,
    states: deriveNodeStates(map, { proven: { joins: attempt.id } }),
    attempts: { joins: attempt },
  };
}

function snapshotFor(map: SkillMap, attempt: Attempt) {
  return buildSnapshot(snapshotInput(map, attempt));
}

/** From origin/main's snapshot.ts and hash.ts (abd18e7), before grid solves existed, on the data below. */
const OLD_HASH = "480c7bf4b0a66180334bb963f8722eef64e2b5a9a671e186e55d4f27ada3157f";

describe("buildSnapshot", () => {
  const map = makeMap();
  const attempt = makeAttempt(map, "joins");

  it("includes only proven skills, and lists the rest honestly", () => {
    const snapshot = snapshotFor(map, attempt);
    expect(snapshot.skills.map((skill) => skill.nodeId)).toEqual(["joins"]);
    expect(snapshot.notYetProven).toEqual(["Skill windows"]);
    expect(snapshot.totalSkills).toBe(2);
    expect(snapshot.skills[0].source).toEqual({ status: "verified", kind: "posting", quote: "Strong SQL required", page: null });
  });

  it("never exposes the owner id, the map id or the source text", () => {
    const text = JSON.stringify(snapshotFor(map, attempt));
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain(map.id);
    expect(text).not.toContain(attempt.id);
    expect(text).not.toContain("PRIVATE POSTING TEXT");
  });

  it("says a topic map's skills are AI-generated, and keeps a PDF citation's page", () => {
    const topic = { ...makeMap(), sourceKind: "topic" as const };
    expect(snapshotFor(topic, makeAttempt(topic, "joins")).skills[0].source).toEqual({ status: "topic" });

    const citation = { kind: "pdf" as const, quote: "Strong SQL required", page: 3, verified: true };
    const pdf = { ...makeMap(), sourceKind: "pdf" as const, nodes: [{ ...makeNode("joins"), citation }] };
    expect(snapshotFor(pdf, makeAttempt(pdf, "joins")).skills[0].source).toEqual({ status: "verified", kind: "pdf", quote: "Strong SQL required", page: 3 });
  });

  it("does not show a citation that code could not verify", () => {
    const unverified = { ...makeMap(), nodes: [{ ...makeNode("joins"), citation: { kind: "posting" as const, quote: "", verified: false } }] };
    const snapshot = snapshotFor(unverified, makeAttempt(unverified, "joins"));
    expect(snapshot.skills[0].source).toEqual({ status: "unverified" });
  });

  it("labels a skill the source does not ask for as a foundation", () => {
    const foundation = { ...makeMap(), nodes: [{ ...makeNode("joins"), fromSource: false, citation: null }] };
    const snapshot = snapshotFor(foundation, makeAttempt(foundation, "joins"));
    expect(snapshot.skills[0].source).toEqual({ status: "foundation" });
  });
});

describe("grid practice on the record", () => {
  const solve: GridSolve = {
    exerciseId: "reserve-margin",
    title: "Reserve margin",
    skill: "the reserve margin",
    asOf: "2026-11-07T13:45:00-06:00",
    asOfLabel: "Nov 07, 2026 13:45",
    answer: "31 MW",
    figures: [{ label: "Dispatched reserve", value: "510 MW" }],
    working: ["Dispatched minus required: 510 − 479 = 31 MW."],
    stale: false,
    solvedAt: "2026-11-07T19:50:00.000Z",
  };

  it("leaves the field out with no solves, so a record from before it existed keeps its fingerprint", () => {
    const map = makeMap();
    const snapshot = snapshotFor(map, makeAttempt(map, "joins"));
    expect(snapshot.skills).toHaveLength(1);
    expect("grid" in snapshot).toBe(false);
    // Worked out on main before grid solves existed, from this same test data.
    expect(hashSnapshot(snapshot)).toBe(OLD_HASH);
  });

  it("adds solves without ids or AESO's ISO time, and the fingerprint covers them", () => {
    const map = makeMap();
    const attempt = makeAttempt(map, "joins");
    const snapshot = buildSnapshot({ ...snapshotInput(map, attempt), gridSolves: [solve] });
    expect(snapshot.grid).toEqual([
      { title: "Reserve margin", skill: "the reserve margin", answer: "31 MW", asOfLabel: "Nov 07, 2026 13:45", figures: solve.figures, working: solve.working, stale: false, solvedAt: solve.solvedAt },
    ]);
    const hash = hashSnapshot(snapshot);
    expect(checkSnapshot(snapshot, hash).hashMatches).toBe(true);
    const edited = { ...snapshot, grid: [{ ...snapshot.grid![0], answer: "90 MW" }] };
    expect(checkSnapshot(edited, hash).hashMatches).toBe(false);
  });

  it("includes the owner's solves only when the map is energy related", async () => {
    const owner = randomUUID();
    await putDoc(`grid-solves/${owner}/reserve-margin`, solve);

    for (const [sourceText, expected] of [["Data analyst for AESO grid operations.", 1], ["Barista, Calgary.", 0]] as const) {
      const map = { ...makeMap(), ownerId: owner, sourceText };
      const attempt = makeAttempt(map, "joins", { ownerId: owner });
      await putDoc(`maps/${map.id}`, map);
      await putDoc(`attempts/${attempt.id}`, attempt);
      await putDoc(`progress/${map.id}/${owner}/joins`, { nodeId: "joins", attemptId: attempt.id, provenAt: "2026-11-07T11:00:00.000Z" });
      const record = await publishProof(owner, map.id, "Maya Chen");
      expect(record.snapshot.grid?.length ?? 0).toBe(expected);
    }
  });
});

describe("attemptProvesNode", () => {
  const map = makeMap();
  const node = map.nodes[0];

  it("accepts a finished, passing attempt", () => {
    expect(attemptProvesNode(makeAttempt(map, "joins"), map, node)).toBe(true);
  });

  it.each<[string, Partial<Attempt>]>([
    ["someone else's attempt", { ownerId: "someone-else" }],
    ["an attempt on another map", { mapId: randomUUID() }],
    ["an attempt on another skill", { nodeId: "windows" }],
    ["an attempt with an open follow-up", { status: "needs-followup" }],
    ["a failed follow-up", { followUp: { question: "Q", answer: "A", passed: false, feedback: "F" } }],
  ])("rejects %s", (_name, overrides) => {
    expect(attemptProvesNode(makeAttempt(map, "joins", overrides), map, node)).toBe(false);
  });

  it("rejects a score under the pass mark", () => {
    const attempt = makeAttempt(map, "joins");
    attempt.grade.score = 40;
    expect(attemptProvesNode(attempt, map, node)).toBe(false);
  });

  it("rejects a quote that is not in the person's text", () => {
    const attempt = makeAttempt(map, "joins");
    attempt.grade.checkpoints[0].quote = "words they never wrote";
    expect(attemptProvesNode(attempt, map, node)).toBe(false);
  });
});

describe("proving formats on the record", () => {
  const map = makeMap();
  const node = map.nodes[0];
  const record = {
    sentences: ["Joins combine tables.", "An inner join keeps every row."],
    planted: [{ sentence: 2, why: "An inner join keeps only matching rows." }],
    picks: [{ sentence: 2, correction: "It keeps only matching rows.", fixed: true }],
  };
  const caught = makeAttempt(map, "joins", {
    format: "catch",
    catch: record,
    followUp: null,
    explanation: "Sentence 2: It keeps only matching rows.",
    grade: {
      score: 100,
      checkpoints: [{ checkpoint: "Inner join keeps only matches", quote: "It keeps only matching rows.", met: true }],
      misconceptions: [],
      rejectedQuotes: 0,
    },
  });

  it("accepts a caught mistake with no follow-up, and shows the round", () => {
    expect(attemptProvesNode(caught, map, node)).toBe(true);
    const skill = buildSnapshot({ ...snapshotInput(map, caught), attempts: { joins: caught } }).skills[0];
    expect(skill.format).toBe("catch");
    // Only counts are kept: the planted sentences are shared by every copy of a course.
    expect(skill.catch).toEqual({ plantedCount: 1, caughtCount: 1, wrongTaps: 0 });
    expect(JSON.stringify(skill)).not.toContain("An inner join keeps every row");
    expect(skill.explanation).toBe("");
  });

  it("needs a passed follow-up for every other format, unless the score was strong", () => {
    const borderline = { ...caught, format: "kid" as const, catch: undefined, grade: { ...caught.grade, score: 55 } };
    expect(attemptProvesNode(borderline, map, node)).toBe(false);
    expect(attemptProvesNode({ ...caught, format: "kid", catch: undefined }, map, node)).toBe(true);
  });

  it("leaves format out for Explain it, so older records keep their fingerprint", () => {
    expect(snapshotFor(map, makeAttempt(map, "joins")).skills[0]).not.toHaveProperty("format");
  });
});

describe("the fingerprint", () => {
  const map = makeMap();
  const attempt = makeAttempt(map, "joins");

  it("is SHA-256 of the canonical text, whatever order the keys are in", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
    const snapshot = snapshotFor(map, attempt);
    const reversed = Object.fromEntries(Object.entries(snapshot).reverse()) as typeof snapshot;
    expect(hashSnapshot(reversed)).toBe(hashSnapshot(snapshot));
    expect(hashSnapshot(snapshot)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("leaves out how the follow-up was answered when that wasn't recorded, so older records still match", () => {
    const old = snapshotFor(map, attempt).skills[0].followUp;
    expect(Object.keys(old).sort()).toEqual(["answer", "feedback", "question"]);
  });

  it("covers how the follow-up was answered once it is recorded", () => {
    const spoken = makeAttempt(map, "joins", {
      followUp: { ...attempt.followUp!, inputMethod: "voice", startedAfterMs: 9_000 },
    });
    const snapshot = snapshotFor(map, spoken);
    expect(snapshot.skills[0].followUp).toMatchObject({ inputMethod: "voice", startedAfterMs: 9_000 });

    const hash = hashSnapshot(snapshot);
    snapshot.skills[0].followUp.inputMethod = "typed";
    expect(checkSnapshot(snapshot, hash).hashMatches).toBe(false);
  });

  it("survives being stored and read back as JSON", () => {
    const snapshot = snapshotFor(map, attempt);
    expect(hashSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(hashSnapshot(snapshot));
  });

  it("passes every check on an untouched record", () => {
    const snapshot = snapshotFor(map, attempt);
    const result = checkSnapshot(snapshot, hashSnapshot(snapshot));
    expect(result.hashMatches).toBe(true);
    expect(result.quotes).toEqual({ verified: 2, total: 2 });
    expect(result.scores).toEqual({ matching: 1, total: 1 });
  });

  it("catches one changed letter", () => {
    const snapshot = snapshotFor(map, attempt);
    const hash = hashSnapshot(snapshot);
    snapshot.skills[0].explanation = snapshot.skills[0].explanation.replace("inner", "outer");
    expect(checkSnapshot(snapshot, hash).hashMatches).toBe(false);
  });

  it("catches a score or a quote that was changed by hand", () => {
    const snapshot = snapshotFor(map, attempt);
    snapshot.skills[0].score = 90;
    snapshot.skills[0].checkpoints[0].quote = "words they never wrote";
    const result = checkSnapshot(snapshot, hashSnapshot(snapshot));
    expect(result.scores).toEqual({ matching: 0, total: 1 });
    expect(result.quotes).toEqual({ verified: 1, total: 2 });
  });
});

describe("the seal", () => {
  const map = makeMap();
  const attempt = makeAttempt(map, "joins");

  afterEach(() => vi.unstubAllEnvs());

  it("says nothing when the server has no key", () => {
    vi.stubEnv("PROOF_SEAL_SECRET", "");
    const snapshot = snapshotFor(map, attempt);
    const hash = hashSnapshot(snapshot);
    expect(sealFor(hash)).toBeNull();
    expect(checkSnapshot(snapshot, hash, null).sealMatches).toBeNull();
  });

  it("passes on an untouched record", () => {
    vi.stubEnv("PROOF_SEAL_SECRET", "test-key");
    const snapshot = snapshotFor(map, attempt);
    const hash = hashSnapshot(snapshot);
    expect(checkSnapshot(snapshot, hash, sealFor(hash)).sealMatches).toBe(true);
  });

  it("catches a store edit that rehashes the record, which the plain fingerprint can't", () => {
    vi.stubEnv("PROOF_SEAL_SECRET", "test-key");
    const snapshot = snapshotFor(map, attempt);
    const seal = sealFor(hashSnapshot(snapshot));

    snapshot.displayName = "Someone Else";
    const rehashed = hashSnapshot(snapshot);

    const result = checkSnapshot(snapshot, rehashed, seal);
    expect(result.hashMatches).toBe(true);
    expect(result.sealMatches).toBe(false);
  });

  it("fails a record whose seal was stripped, and one sealed with another key", () => {
    vi.stubEnv("PROOF_SEAL_SECRET", "test-key");
    const snapshot = snapshotFor(map, attempt);
    const hash = hashSnapshot(snapshot);
    expect(checkSnapshot(snapshot, hash, null).sealMatches).toBe(false);
    expect(checkSnapshot(snapshot, hash, undefined).sealMatches).toBe(false);

    const seal = sealFor(hash);
    vi.stubEnv("PROOF_SEAL_SECRET", "another-key");
    expect(checkSnapshot(snapshot, hash, seal).sealMatches).toBe(false);
  });
});

describe("publishProof", () => {
  let map: SkillMap;
  let attempt: Attempt;

  beforeEach(async () => {
    ({ map, attempt } = await seedProvenMap());
  });

  it("publishes from server data with a short unguessable id", async () => {
    const proof = await publishProof(OWNER, map.id, "  Maya   Chen ");
    expect(proof.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(proof.snapshot.displayName).toBe("Maya Chen");
    expect(proof.snapshot.skills).toHaveLength(1);
    expect(proof.hash).toBe(hashSnapshot(proof.snapshot));
    expect(checkSnapshot(proof.snapshot, proof.hash).hashMatches).toBe(true);
  });

  it("gives two maps different ids", async () => {
    const other = await seedProvenMap();
    const first = await publishProof(OWNER, map.id, "Maya");
    const second = await publishProof(OWNER, other.map.id, "Maya");
    expect(first.id).not.toBe(second.id);
  });

  it("refuses anyone but the owner", async () => {
    await expect(publishProof("someone-else", map.id, "Mallory")).rejects.toMatchObject({ status: 404 });
    expect(await getDoc(`proof-index/${map.id}`)).toBeNull();
  });

  it("refuses a map that does not exist", async () => {
    await expect(publishProof(OWNER, randomUUID(), "Maya")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to publish with no proven skill", async () => {
    await deleteDoc(`progress/${map.id}/${OWNER}/joins`);
    await expect(publishProof(OWNER, map.id, "Maya")).rejects.toMatchObject({ status: 400 });
  });

  it("does not count progress whose attempt never finished", async () => {
    await putDoc(`attempts/${attempt.id}`, { ...attempt, status: "needs-followup" });
    await expect(publishProof(OWNER, map.id, "Maya")).rejects.toMatchObject({ status: 400 });
  });

  it("does not count progress pointing at an attempt that is gone", async () => {
    await markProven(map, "joins", randomUUID());
    await expect(publishProof(OWNER, map.id, "Maya")).rejects.toMatchObject({ status: 400 });
  });

  it("updates the same id when published again, with the new skill and a new fingerprint", async () => {
    const first = await publishProof(OWNER, map.id, "Maya");

    const second = makeAttempt(map, "windows");
    await putDoc(`attempts/${second.id}`, second);
    await markProven(map, "windows", second.id);

    const updated = await publishProof(OWNER, map.id, "Maya Chen");
    expect(updated.id).toBe(first.id);
    expect(updated.snapshot.skills).toHaveLength(2);
    expect(updated.hash).not.toBe(first.hash);
    expect(((await getProof(first.id)) as LiveProof).snapshot.displayName).toBe("Maya Chen");
  });
});

describe("revokeProof", () => {
  let map: SkillMap;
  let proof: LiveProof;

  beforeEach(async () => {
    ({ map } = await seedProvenMap());
    proof = await publishProof(OWNER, map.id, "Maya Chen");
  });

  it("refuses anyone but the owner, and leaves the page live", async () => {
    await expect(revokeProof("someone-else", proof.id)).rejects.toBeInstanceOf(ProofError);
    await expect(revokeProof("someone-else", proof.id)).rejects.toMatchObject({ status: 403 });
    expect((await getProof(proof.id))?.state).toBe("live");
  });

  it("deletes the person's words and keeps only a note", async () => {
    await revokeProof(OWNER, proof.id);
    const stored = await getProof(proof.id);
    expect(stored?.state).toBe("revoked");
    const text = JSON.stringify(stored);
    expect(text).not.toContain("Maya");
    expect(text).not.toContain("inner join");
    expect(text).not.toContain(proof.hash);
  });

  it("can be withdrawn twice without changing the date", async () => {
    const first = await revokeProof(OWNER, proof.id);
    const second = await revokeProof(OWNER, proof.id);
    expect(second.revokedAt).toBe(first.revokedAt);
  });

  it("comes back at the same link when published again", async () => {
    await revokeProof(OWNER, proof.id);
    const back = await publishProof(OWNER, map.id, "Maya Chen");
    expect(back.id).toBe(proof.id);
    expect(back.state).toBe("live");
  });

  it("tells the owner the state, without leaking it to their view as contents", async () => {
    await revokeProof(OWNER, proof.id);
    const record = await getOwnProofForMap(OWNER, map.id);
    expect(record && toOwnerView(record)).toMatchObject({ id: proof.id, state: "revoked", displayName: null, hash: null });
  });

  it("will not hand the owner's page to someone else", async () => {
    await expect(getOwnProofForMap("someone-else", map.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("getProof", () => {
  it("ignores ids that could not be ours, so nothing odd reaches a store key", async () => {
    expect(await getProof("../maps/secret")).toBeNull();
    expect(await getProof("short")).toBeNull();
    expect(await getProof("aaaaaaaaaaaaaaaa")).toBeNull();
  });
});

describe("cleanDisplayName", () => {
  it("tidies spacing and keeps accents", () => {
    expect(cleanDisplayName("  Zoë\t  Ñandú ")).toBe("Zoë Ñandú");
  });

  it.each(["", "   ", "...", "a".repeat(61)])("refuses %j", (name) => {
    expect(() => cleanDisplayName(name)).toThrow(ProofError);
  });
});
