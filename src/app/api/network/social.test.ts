/**
 * Friend requests, pings, friends' courses and the privacy settings, end to end through the
 * routes, with a fake identity and the in-memory store. Every body is checked for ids.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId } from "@/shared/identity";
import { saveSkillMap } from "@/features/skill-map";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { DELETE as dismissRoute } from "./pings/[publicId]/route";
import { POST as pingRoute } from "./pings/route";
import { POST as acceptRoute } from "./requests/[publicId]/accept/route";
import { DELETE as declineRoute } from "./requests/[publicId]/route";
import { POST as requestRoute } from "./requests/route";
import { GET, PATCH, PUT } from "./route";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn(), getSession: vi.fn() }));

const ANA = randomUUID();
const BO = randomUUID();
const CY = randomUUID();
const asUser = (id: string) => vi.mocked(getUserId).mockResolvedValue(id);
let bosMap: SkillMap;

type View = {
  me: { publicId: string };
  friends: { profile: { displayName: string }; canPing?: boolean; courses?: unknown }[];
  everyone: { profile: { displayName: string; publicId: string }; canRequest?: boolean; requestSent?: boolean }[];
  mentors: View["everyone"];
  peers: View["everyone"];
  friendRequests: { displayName: string; publicId: string }[];
  pings: { displayName: string; publicId: string }[];
};

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  for (const secret of [ANA, BO, CY, bosMap.id, "userId", "ownerId", "mapId"]) expect(text).not.toContain(secret);
  return JSON.parse(text) as T;
}

function json(payload: unknown, method: string): Request {
  return new Request("http://localhost/api/network", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
const params = (publicId: string) => ({ params: Promise.resolve({ publicId }) });
const empty = (method: string) => new Request("http://localhost", { method });

async function join(id: string, displayName: string): Promise<string> {
  asUser(id);
  const { me } = await body<{ me: { publicId: string } }>(await PUT(json({ displayName, inNetwork: true }, "PUT")));
  return me.publicId;
}

async function view(id: string): Promise<View> {
  asUser(id);
  return body<View>(await GET());
}

const everyoneIn = (v: View) => [...v.mentors, ...v.peers, ...v.everyone];

beforeEach(async () => {
  for (const name of ["BLOB_READ_WRITE_TOKEN", "AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"]) {
    vi.stubEnv(name, "");
  }
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  bosMap = {
    id: randomUUID(),
    ownerId: BO,
    title: "Data analyst",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "posting",
    nodes: ["joins", "views", "indexes"].map((id) => ({
      id,
      title: `SQL ${id}`,
      why: "Why.",
      prerequisites: [],
      fromSource: true,
      citation: null,
      checkpoints: ["x", "y", "z"],
    })),
    createdAt: new Date().toISOString(),
  };
  await saveSkillMap(bosMap);
  await putDoc(`progress/${bosMap.id}/${BO}/joins`, { nodeId: "joins", attemptId: randomUUID(), provenAt: new Date().toISOString() });
});

async function befriend(): Promise<{ ana: string; bo: string }> {
  const ana = await join(ANA, "Ana");
  const bo = await join(BO, "Bo");
  asUser(ANA);
  await body(await requestRoute(json({ publicId: bo }, "POST")));
  asUser(BO);
  await body(await acceptRoute(empty("POST"), params(ana)));
  return { ana, bo };
}

describe("friend requests", () => {
  it("send, see it, accept, and become friends", async () => {
    const ana = await join(ANA, "Ana");
    const bo = await join(BO, "Bo");

    asUser(ANA);
    expect(everyoneIn(await view(ANA)).find((m) => m.profile.displayName === "Bo")).toMatchObject({ canRequest: true, requestSent: false });
    expect(await body(await requestRoute(json({ publicId: bo }, "POST")))).toEqual({ status: "sent" });
    expect(everyoneIn(await view(ANA)).find((m) => m.profile.displayName === "Bo")?.requestSent).toBe(true);

    const bos = await view(BO);
    expect(bos.friendRequests).toMatchObject([{ displayName: "Ana", publicId: ana }]);
    asUser(BO);
    expect(await body(await acceptRoute(empty("POST"), params(ana)))).toEqual({ friend: "Ana" });

    const after = await view(BO);
    expect(after.friendRequests).toEqual([]);
    expect(after.friends.map((f) => f.profile.displayName)).toEqual(["Ana"]);
    expect((await view(ANA)).friends.map((f) => f.profile.displayName)).toEqual(["Bo"]);
    // Accepting twice finds nothing.
    asUser(BO);
    expect((await acceptRoute(empty("POST"), params(ana))).status).toBe(404);
  });

  it("accepts at once when the other person already asked", async () => {
    const ana = await join(ANA, "Ana");
    const bo = await join(BO, "Bo");
    asUser(ANA);
    await body(await requestRoute(json({ publicId: bo }, "POST")));
    asUser(BO);
    expect(await body(await requestRoute(json({ publicId: ana }, "POST")))).toEqual({ status: "friends" });
    expect((await view(BO)).friends).toHaveLength(1);
    expect((await view(ANA)).friendRequests).toEqual([]);
  });

  it("decline removes it, and allowRequests off refuses with 403 and hides the button", async () => {
    const ana = await join(ANA, "Ana");
    const bo = await join(BO, "Bo");
    asUser(ANA);
    await body(await requestRoute(json({ publicId: bo }, "POST")));
    asUser(BO);
    expect(await body(await declineRoute(empty("DELETE"), params(ana)))).toEqual({ ok: true });
    expect((await view(BO)).friendRequests).toEqual([]);
    expect((await view(BO)).friends).toEqual([]);

    asUser(BO);
    expect((await body(await PATCH(json({ allowRequests: false }, "PATCH")))).me).toMatchObject({ allowRequests: false, inNetwork: true });
    expect(everyoneIn(await view(ANA)).find((m) => m.profile.displayName === "Bo")?.canRequest).toBe(false);
    asUser(ANA);
    const refused = await requestRoute(json({ publicId: bo }, "POST"));
    expect(refused.status).toBe(403);
    expect(await body(refused)).toEqual({ error: expect.stringMatching(/isn't taking friend requests/) });
  });

  it("needs a profile to send", async () => {
    const bo = await join(BO, "Bo");
    asUser(CY);
    expect((await requestRoute(json({ publicId: bo }, "POST"))).status).toBe(400);
  });
});

describe("pings", () => {
  it("only friends, once an hour, and dismiss deletes it", async () => {
    const ana = await join(ANA, "Ana");
    const bo = await join(BO, "Bo");
    asUser(ANA);
    expect((await pingRoute(json({ publicId: bo }, "POST"))).status).toBe(403);

    asUser(ANA);
    await body(await requestRoute(json({ publicId: bo }, "POST")));
    asUser(BO);
    await body(await acceptRoute(empty("POST"), params(ana)));
    expect((await view(ANA)).friends[0].canPing).toBe(true);

    asUser(ANA);
    expect(await body(await pingRoute(json({ publicId: bo }, "POST")))).toEqual({ ok: true });
    const again = await pingRoute(json({ publicId: bo }, "POST"));
    expect(again.status).toBe(429);
    expect(await body(again)).toEqual({ error: expect.stringMatching(/already pinged Bo/) });

    expect((await view(BO)).pings).toMatchObject([{ displayName: "Ana", publicId: ana }]);
    asUser(BO);
    expect(await body(await dismissRoute(empty("DELETE"), params(ana)))).toEqual({ ok: true });
    expect((await view(BO)).pings).toEqual([]);
    // Dismissing doesn't reset the hourly limit.
    asUser(ANA);
    expect((await pingRoute(json({ publicId: bo }, "POST"))).status).toBe(429);
  });

  it("allowPings off refuses and hides Ping", async () => {
    const { bo } = await befriend();
    asUser(BO);
    await body(await PATCH(json({ allowPings: false }, "PATCH")));
    expect((await view(ANA)).friends[0].canPing).toBe(false);
    asUser(ANA);
    const refused = await pingRoute(json({ publicId: bo }, "POST"));
    expect(refused.status).toBe(403);
    expect(await body(refused)).toEqual({ error: "Bo has pings turned off." });
  });
});

describe("friends' courses", () => {
  it("shows title and progress, and hides them when shareProgress is off", async () => {
    await befriend();
    expect((await view(ANA)).friends[0].courses).toEqual([{ title: "Data analyst", proven: 1, total: 3 }]);
    asUser(BO);
    expect((await body(await PATCH(json({ shareProgress: false }, "PATCH")))).me).toMatchObject({ shareProgress: false });
    expect((await view(ANA)).friends[0].courses).toBeNull();
    // Editing the profile keeps the setting.
    asUser(BO);
    expect((await body(await PUT(json({ displayName: "Bo B." }, "PUT")))).me).toMatchObject({ shareProgress: false });
  });

  it("settings default to on, and PATCH refuses an empty body", async () => {
    await join(ANA, "Ana");
    expect((await view(ANA)).me).toMatchObject({ shareProgress: true, allowRequests: true, allowPings: true });
    asUser(ANA);
    expect((await PATCH(json({}, "PATCH"))).status).toBe(400);
    asUser(CY);
    expect((await PATCH(json({ allowPings: false }, "PATCH"))).status).toBe(400);
  });
});
