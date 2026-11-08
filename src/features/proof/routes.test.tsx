import { createHash, randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/proof/[id]/route";
import { GET as verify } from "@/app/api/proof/[id]/verify/route";
import { GET, POST } from "@/app/api/proof/route";
import ProofPage from "@/app/proof/[id]/page";
import { proxy } from "@/proxy";
import { readUserId } from "@/shared/identity";
import { putDoc } from "@/shared/store";
import type { Attempt, SkillMap } from "@/shared/types";
import { isProofGone } from "./page";
import { getProof } from "./publish";
import { ProofScreen } from "./ui/ProofScreen";

vi.mock("@/shared/identity", () => ({ readUserId: vi.fn(), getUserId: vi.fn(), userIdFromCookies: () => null }));
vi.mock("next/server", async (original) => ({ ...(await original<object>()), connection: async () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "oryx.example", "x-forwarded-proto": "https" }),
}));
const mockUser = vi.mocked(readUserId);

const OWNER = randomUUID();
const EXPLANATION = "An inner join keeps only rows that match in both tables, and a left join keeps every left row.";

let map: SkillMap;

async function seed() {
  map = {
    id: randomUUID(),
    ownerId: OWNER,
    title: "Data Analyst",
    subtitle: "Calgary, AB",
    sourceKind: "posting",
    sourceText: "PRIVATE POSTING TEXT",
    nodes: [
      {
        id: "joins",
        title: "SQL joins",
        why: "Needed for the job.",
        prerequisites: [],
        fromSource: true,
        citation: { kind: "posting", quote: "Strong SQL required", verified: true },
        checkpoints: ["Inner join keeps matches"],
      },
    ],
    createdAt: "2026-11-07T10:00:00.000Z",
  };
  const attempt: Attempt = {
    id: randomUUID(),
    mapId: map.id,
    nodeId: "joins",
    ownerId: OWNER,
    explanation: EXPLANATION,
    integrity: { pasted: true, activeMs: 134_000, wordCount: 18, inputMethod: "typed" },
    grade: {
      score: 100,
      checkpoints: [{ checkpoint: "Inner join keeps matches", quote: "keeps only rows that match", met: true }],
      misconceptions: [],
      rejectedQuotes: 0,
    },
    followUp: { question: "What about a row with no match?", answer: "It is dropped.", passed: true, feedback: "Right." },
    status: "proven",
    createdAt: "2026-11-07T11:00:00.000Z",
  };
  await putDoc(`maps/${map.id}`, map);
  await putDoc(`attempts/${attempt.id}`, attempt);
  await putDoc(`progress/${map.id}/${OWNER}/joins`, { nodeId: "joins", attemptId: attempt.id, provenAt: "2026-11-07T11:00:00.000Z" });
}

function post(displayName = "Maya Chen") {
  return POST(new Request("http://test/api/proof", { method: "POST", body: JSON.stringify({ mapId: map.id, displayName }) }));
}

const asParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function publishAsOwner(): Promise<string> {
  mockUser.mockResolvedValue(OWNER);
  const { proof } = await (await post()).json();
  return proof.id;
}

async function renderPage(id: string): Promise<string> {
  return renderToStaticMarkup(await ProofScreen({ id }));
}

beforeEach(async () => {
  mockUser.mockReset();
  await seed();
});

describe("the proof API", () => {
  it("refuses a visitor with no identity", async () => {
    mockUser.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it("refuses someone else, with a sentence a person can read", async () => {
    mockUser.mockResolvedValue(randomUUID());
    const response = await post();
    // Same answer as a missing map, so it doesn't show that the map exists.
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/could not find that map/);
  });

  it("explains an unreadable request", async () => {
    mockUser.mockResolvedValue(OWNER);
    const response = await POST(new Request("http://test/api/proof", { method: "POST", body: "not json" }));
    expect(response.status).toBe(400);
  });

  it("publishes, and the owner can find the page again", async () => {
    const id = await publishAsOwner();
    const reply = await GET(new Request(`http://test/api/proof?mapId=${map.id}`));
    expect((await reply.json()).proof).toMatchObject({ id, path: `/proof/${id}`, state: "live", provenCount: 1, totalSkills: 1 });
  });

  it("only lets the owner withdraw", async () => {
    const id = await publishAsOwner();
    mockUser.mockResolvedValue(randomUUID());
    expect((await DELETE(new Request("http://test"), asParams(id))).status).toBe(403);
    mockUser.mockResolvedValue(OWNER);
    expect((await DELETE(new Request("http://test"), asParams(id))).status).toBe(200);
  });
});

describe("the public verify route", () => {
  it("works with no identity and recomputes the fingerprint", async () => {
    const id = await publishAsOwner();
    mockUser.mockResolvedValue(null);

    const response = await verify(new Request("http://test"), asParams(id));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ state: "live", hashMatches: true, quotes: { verified: 1, total: 1 }, scores: { matching: 1, total: 1 } });
    expect(body.recomputedHash).toBe(body.storedHash);

    expect(createHash("sha256").update(body.canonical, "utf8").digest("hex")).toBe(body.storedHash);
  });

  it("never reveals the owner, the map or the source", async () => {
    const id = await publishAsOwner();
    const text = await (await verify(new Request("http://test"), asParams(id))).text();
    expect(text).not.toContain(OWNER);
    expect(text).not.toContain(map.id);
    expect(text).not.toContain("PRIVATE POSTING TEXT");
  });

  it("detects a stored record edited behind our back", async () => {
    const id = await publishAsOwner();
    const stored = await getProof(id);
    if (stored?.state !== "live") throw new Error("expected a live record");
    stored.snapshot.skills[0].followUp.answer = "Something better they never wrote.";
    await putDoc(`proofs/${id}`, stored);

    const body = await (await verify(new Request("http://test"), asParams(id))).json();
    expect(body.hashMatches).toBe(false);
  });

  it("reports a withdrawn or unknown record", async () => {
    const id = await publishAsOwner();
    await DELETE(new Request("http://test"), asParams(id));
    expect(await (await verify(new Request("http://test"), asParams(id))).json()).toMatchObject({ state: "revoked" });
    expect((await verify(new Request("http://test"), asParams("aaaaaaaaaaaaaaaa"))).status).toBe(404);
  });
});

describe("the public page", () => {
  it("shows the whole record to a stranger, and nothing private", async () => {
    const id = await publishAsOwner();
    mockUser.mockResolvedValue(null);
    const html = await renderPage(id);

    for (const text of [
      "Maya Chen",
      "Data Analyst",
      "SQL joins",
      "keeps only rows that match",
      "What about a row with no match?",
      "It is dropped.",
      "Some text was pasted",
      "2 min 14 s active",
      "18 words",
      "Strong SQL required",
      "How this was checked",
      "does not show",
      "a posting this person supplied",
      "That the source is real",
      "SHA-256",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain("<mark");
    expect(html).toContain("<svg"); // the QR code
    expect(html).not.toContain(OWNER);
    expect(html).not.toContain(map.id);
    expect(html).not.toContain("PRIVATE POSTING TEXT");
  });

  it("tells the owner when their record was withdrawn, and keeps none of it", async () => {
    const id = await publishAsOwner();
    await DELETE(new Request("http://test"), asParams(id));
    const html = await renderPage(id);
    expect(html).toContain("Back to your map");
    expect(html).toContain("This record was withdrawn");
    expect(html).toContain("the public copy has been removed");
    expect(html).not.toContain("deleted");
    expect(html).not.toContain("Maya Chen");
    expect(html).not.toContain("keeps only rows");
  });

  it("says plainly when there is no such record, and a withdrawn one is gone for strangers", async () => {
    expect(await renderPage("aaaaaaaaaaaaaaaa")).toContain("We could not find this evidence record");
    const id = await publishAsOwner();
    await DELETE(new Request("http://test"), asParams(id));
    mockUser.mockResolvedValue(null);
    expect(await renderPage(id)).toContain("We could not find this evidence record");
  });

  it("sends a missing or withdrawn record to the static 404 in the proxy, before the page streams", async () => {
    const { NextRequest } = await import("next/server");
    const rewriteOf = async (id: string) =>
      (await proxy(new NextRequest(`http://oryx.example/proof/${id}`))).headers.get("x-middleware-rewrite");
    expect(await rewriteOf("aaaaaaaaaaaaaaaa")).toBe("http://oryx.example/proof/gone");
    const id = await publishAsOwner();
    expect(await rewriteOf(id)).toBeNull();
    await DELETE(new Request("http://test"), asParams(id));
    expect(await rewriteOf(id)).toBe("http://oryx.example/proof/gone"); // no cookie: a stranger
    expect(await isProofGone(id, OWNER)).toBe(false); // the owner still sees when it was taken down
  });

  it("still says not found if the record goes between the proxy and the page", async () => {
    const statusOf = (id: string) =>
      ProofPage(asParams(id)).then(
        () => 200,
        (error: { digest?: string }) => Number(error.digest?.split(";").at(-1)),
      );
    expect(await statusOf("aaaaaaaaaaaaaaaa")).toBe(404);
    const id = await publishAsOwner();
    mockUser.mockResolvedValue(null);
    expect(await statusOf(id)).toBe(200);
    mockUser.mockResolvedValue(OWNER);
    await DELETE(new Request("http://test"), asParams(id));
    expect(await statusOf(id)).toBe(200); // the owner still sees when it was taken down
    mockUser.mockResolvedValue(null);
    expect(await statusOf(id)).toBe(404);
  });
});
