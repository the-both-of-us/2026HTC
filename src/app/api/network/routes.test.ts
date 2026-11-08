/**
 * The network route end to end, with a fake identity and the in-memory store.
 * The main promise checked here: no response ever carries a user id or another person's map id.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId } from "@/shared/identity";
import { saveSkillMap } from "@/features/skill-map";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { DELETE as removeFriendRoute } from "./friends/[publicId]/route";
import { GET as inviteGET, POST as invitePOST } from "./invite/[code]/route";
import { POST as createInviteRoute } from "./invite/route";
import { DELETE, GET, PATCH, PUT } from "./route";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn(), getSession: vi.fn() }));

const ANA = randomUUID();
const BO = randomUUID();
const asUser = (id: string) => vi.mocked(getUserId).mockResolvedValue(id);
let bosMap: SkillMap;
let anasMap: SkillMap;

function makeMap(ownerId: string, nodes: [string, string][]): SkillMap {
  return {
    id: randomUUID(),
    ownerId,
    title: "Data analyst",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "posting",
    nodes: nodes.map(([id, title]) => ({ id, title, why: "Why.", prerequisites: [], fromSource: true, citation: null, checkpoints: ["x", "y", "z"] })),
    createdAt: new Date().toISOString(),
  };
}

/** Reads the body and checks it holds no identity and no map id. */
async function body(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  for (const secret of [ANA, BO, bosMap.id, anasMap.id, "userId", "ownerId", "mapId", "demo-network-"]) {
    expect(text).not.toContain(secret);
  }
  return JSON.parse(text);
}

function put(payload: unknown, method = "PUT", url = "http://localhost/api/network"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(async () => {
  for (const name of ["BLOB_READ_WRITE_TOKEN", "S3_BUCKET", "AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"]) {
    vi.stubEnv(name, "");
  }
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  bosMap = makeMap(BO, [["joins", "SQL joins"]]);
  anasMap = makeMap(ANA, [["joins", "SQL joins"]]);
  await saveSkillMap(bosMap);
  await saveSkillMap(anasMap);
  await putDoc(`progress/${bosMap.id}/${BO}/joins`, { nodeId: "joins", attemptId: randomUUID(), provenAt: new Date().toISOString() });
});

describe("network route", () => {
  it("join, view, edit and leave, with no ids in any response", async () => {
    asUser(BO);
    const joined = await PUT(
      put({ displayName: "Bo", city: "Calgary", contactUrl: "https://example.com/bo", inNetwork: true }),
    );
    expect(joined.status).toBe(200);
    expect(await body(joined)).toMatchObject({
      me: { displayName: "Bo", provenSkills: [{ title: "SQL joins", mapTitle: "Data analyst", evidenceUrl: null }] },
    });

    asUser(ANA);
    // Friends only until Ana joins: nobody is listed.
    expect(await body(await GET())).toMatchObject({ me: null, inNetwork: false, friends: [], mentors: [], everyone: [] });
    await body(await PUT(put({ displayName: "Ana", inNetwork: true })));
    const view = await body(await GET());
    expect(view).toMatchObject({ inNetwork: true, viewerHasMaps: true, signedIn: false, signInRequired: false });
    const mentors = view.mentors as { profile: { displayName: string }; reasons: string[] }[];
    expect(mentors.find((match) => match.profile.displayName === "Bo")?.reasons).toEqual([
      "Proved SQL joins, which you're learning.",
    ]);

    expect((await body(await PUT(put({ displayName: "Ana" })))).me).toMatchObject({ displayName: "Ana", inNetwork: true });
    expect((await body(await PUT(put({ displayName: "Ana L." })))).me).toMatchObject({ displayName: "Ana L." });
    expect(await body(await DELETE())).toEqual({ ok: true });
    expect((await body(await GET())).me).toBeNull();
  });

  it("answers a bad body or field with a sentence and status 400", async () => {
    asUser(ANA);
    const malformed = await PUT(new Request("http://localhost/api/network", { method: "PUT", body: "{" }));
    expect(malformed.status).toBe(400);
    expect(await body(malformed)).toEqual({ error: expect.stringMatching(/could not read/) });

    const data = await PUT(put({ displayName: "Ana", contactUrl: "data:text/html,hi" }));
    expect(data.status).toBe(400);
    expect(await body(data)).toEqual({ error: expect.stringMatching(/https:\/\//) });
  });

  it("needs a sign-in to join once Auth0 is set up", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "tenant.example.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "fake-client-id");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "fake-client-secret");
    vi.stubEnv("AUTH0_SECRET", "fake-transaction-secret-0123456789abcdef");
    const { getSession } = await import("@/shared/identity");
    vi.mocked(getSession).mockResolvedValue({ userId: ANA, signedIn: false, displayName: null });
    asUser(ANA);

    const refused = await PUT(put({ displayName: "Ana" }));
    expect(refused.status).toBe(401);
    expect(await body(refused)).toEqual({ error: "Sign in to join the network, so people know it's really you." });
    expect(await body(await GET())).toMatchObject({ signInRequired: true });
    // Leaving never needs a sign-in.
    expect((await DELETE()).status).toBe(200);
  });

  it("invite, accept, see each other, toggle the network and remove, with no ids in any response", async () => {
    const params = <T>(value: T) => ({ params: Promise.resolve(value) });
    asUser(BO);
    expect((await createInviteRoute(put({}, "POST"))).status).toBe(400);
    await body(await PUT(put({ displayName: "Bo" })));
    const { code } = (await body(await createInviteRoute(put({}, "POST")))) as { code: string };
    expect(code).toMatch(/^[a-z2-7]{12}$/);

    asUser(ANA);
    const inviteUrl = `http://localhost/api/network/invite/${code}`;
    expect(await body(await inviteGET(new Request(inviteUrl), params({ code })))).toMatchObject({
      inviter: { displayName: "Bo" },
      hasProfile: false,
    });
    expect(await body(await invitePOST(put({ displayName: "Ana" }, "POST", inviteUrl), params({ code })))).toEqual({
      friend: "Bo",
    });
    const anas = await body(await GET());
    expect(anas).toMatchObject({ inNetwork: false, everyone: [], friends: [{ profile: { displayName: "Bo" } }] });

    asUser(BO);
    const bos = await body(await GET());
    const ana = (bos.friends as { profile: { displayName: string; publicId: string } }[])[0].profile;
    expect(ana.displayName).toBe("Ana");
    expect((await body(await PATCH(put({ inNetwork: true }, "PATCH")))).me).toMatchObject({ inNetwork: true });
    expect(await body(await GET())).toMatchObject({ inNetwork: true, friends: [{ profile: { displayName: "Ana" } }] });
    expect((await PATCH(put({ inNetwork: "yes" }, "PATCH"))).status).toBe(400);

    const removed = await removeFriendRoute(new Request("http://localhost"), params({ publicId: ana.publicId }));
    expect(await body(removed)).toEqual({ ok: true });
    expect((await body(await GET())).friends).toEqual([]);
    asUser(ANA);
    expect((await body(await GET())).friends).toEqual([]);
    expect((await inviteGET(new Request(inviteUrl), params({ code: "zzzzzzzzzzzz" }))).status).toBe(404);
  });
});
