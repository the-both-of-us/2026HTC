/**
 * The network with the in-memory store, real identity cookies in a fake jar and fake Auth0
 * values. Skills come from maps and progress records written the way skill-map and
 * teach-back write them.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@/shared/identity";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import { DEMO_PROFILES, DEMO_VERSION, ensureDemoProfiles, resetDemoStateForTests } from "./demo";
import { deleteUserData } from "./deleteData";
import { NetworkError, SIGN_IN_TO_JOIN } from "./errors";
import { getNetwork, joinNetwork, leaveNetwork } from "./network";
import { listProfiles, profileKey } from "./profiles";
import { computeSkills } from "./skills";
import { node, prove, publishEvidence, resetNetwork, saveMap } from "./testing";
import type { ProfileRecord } from "./types";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => jar.delete(name),
  }),
}));

const ANA = randomUUID();
const BO = randomUUID();

function stubAuth(on: boolean) {
  const values = on
    ? {
        AUTH0_DOMAIN: "tenant.example.auth0.com",
        AUTH0_CLIENT_ID: "fake-client-id",
        AUTH0_CLIENT_SECRET: "fake-client-secret",
        AUTH0_SECRET: "fake-transaction-secret-0123456789abcdef",
        APP_BASE_URL: "http://localhost:3000",
      }
    : { AUTH0_DOMAIN: "", AUTH0_CLIENT_ID: "", AUTH0_CLIENT_SECRET: "", AUTH0_SECRET: "", APP_BASE_URL: "" };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

async function statusOf(promise: Promise<unknown>): Promise<{ status: number; message: string } | "ok"> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    return { status: error.status, message: error.message };
  }
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("SESSION_SECRET", "fake-session-secret");
  stubAuth(false);
  jar.clear();
  resetNetwork();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("joining", () => {
  it("lets a guest join while Auth0 is not set up", async () => {
    const me = await joinNetwork(ANA, { displayName: "Ana", city: "Calgary", lookingFor: "A mentor for SQL" });
    expect(me).toMatchObject({ displayName: "Ana", city: "Calgary", lookingFor: "A mentor for SQL", contactUrl: null });
    expect(me).not.toHaveProperty("userId");
  });

  it("needs a sign-in once Auth0 is set up, and accepts one for the same user", async () => {
    stubAuth(true);
    expect(await statusOf(joinNetwork(ANA, { displayName: "Ana" }))).toEqual({ status: 401, message: SIGN_IN_TO_JOIN });
    expect(await getDoc(profileKey(ANA))).toBeNull();

    // Signed in as someone else is not enough.
    await setSessionUser(BO, { displayName: "Bo" });
    expect(await statusOf(joinNetwork(ANA, { displayName: "Ana" }))).toMatchObject({ status: 401 });

    await setSessionUser(ANA, { displayName: "Ana" });
    expect(await statusOf(joinNetwork(ANA, { displayName: "Ana" }))).toBe("ok");
  });

  it("pre-fills the signed-in name and says when sign-in is needed", async () => {
    stubAuth(true);
    expect(await getNetwork(ANA)).toMatchObject({ signedIn: false, signInRequired: true, displayName: null });
    await setSessionUser(ANA, { displayName: "Ana Lopez" });
    expect(await getNetwork(ANA)).toMatchObject({ signedIn: true, signInRequired: false, displayName: "Ana Lopez" });
  });

  it("refuses bad fields with a sentence", async () => {
    expect(await statusOf(joinNetwork(ANA, { displayName: "Ana", contactUrl: "javascript:alert(1)" }))).toMatchObject({
      status: 400,
      message: expect.stringMatching(/https:\/\//),
    });
    expect(await getDoc(profileKey(ANA))).toBeNull();
  });

  it("keeps the public id and join date when the profile is edited", async () => {
    const first = await joinNetwork(ANA, { displayName: "Ana" });
    const second = await joinNetwork(ANA, { displayName: "Ana L.", contactUrl: "https://example.com/ana" });
    expect(second.publicId).toBe(first.publicId);
    expect(second.joinedAt).toBe(first.joinedAt);
    expect(second).toMatchObject({ displayName: "Ana L.", contactUrl: "https://example.com/ana" });
  });

  it("deletes the profile on leaving, and leaving twice is fine", async () => {
    await joinNetwork(ANA, { displayName: "Ana" });
    await leaveNetwork(ANA);
    await leaveNetwork(ANA);
    expect(await getDoc(profileKey(ANA))).toBeNull();
    expect((await getNetwork(ANA)).me).toBeNull();
  });

  it("never lets anyone act as a demo profile", async () => {
    expect(await statusOf(joinNetwork("demo-network-priya", { displayName: "Not Priya" }))).toMatchObject({ status: 400 });
    expect(await statusOf(leaveNetwork("demo-network-priya"))).toMatchObject({ status: 400 });
  });
});

describe("proven skills", () => {
  it("come from progress, never from what was typed", async () => {
    const map = await saveMap(ANA, [node("sql", "SQL queries"), node("joins", "SQL joins", ["sql"]), node("bi", "Power BI")]);
    await prove(map.id, ANA, "sql");

    const typed = { displayName: "Ana", provenSkills: ["Brain surgery"] } as never;
    const me = await joinNetwork(ANA, typed);
    expect(me.provenSkills).toEqual([{ title: "SQL queries", mapTitle: "Data analyst", evidenceUrl: null }]);
    expect(me.learning).toEqual(["SQL joins", "Power BI"]);
    expect(JSON.stringify(await getDoc(profileKey(ANA)))).not.toContain("Brain surgery");
  });

  it("are deduplicated across maps, ignoring case", async () => {
    const one = await saveMap(ANA, [node("a", "SQL joins")], "First");
    const two = await saveMap(ANA, [node("b", "sql JOINS"), node("c", "Python")], "Second");
    await prove(one.id, ANA, "a");
    await prove(two.id, ANA, "b");
    const skills = await computeSkills(ANA);
    expect(skills.proven.map((skill) => skill.title)).toHaveLength(1);
    expect(skills.learning).toEqual(["Python"]);
  });

  it("ignore progress on someone else's map", async () => {
    const bosMap = await saveMap(BO, [node("a", "SQL joins")]);
    await prove(bosMap.id, ANA, "a");
    expect(await computeSkills(ANA)).toEqual({ proven: [], learning: [], hasMaps: false });
  });

  it("link to the owner's own live evidence page, only for skills on it", async () => {
    const map = await saveMap(ANA, [node("a", "SQL queries"), node("b", "SQL joins"), node("c", "Power BI")]);
    await prove(map.id, ANA, "a");
    await prove(map.id, ANA, "b");
    const proofId = await publishEvidence(map, ANA, ["a"]);

    const skills = await computeSkills(ANA);
    expect(skills.proven).toEqual([
      { title: "SQL queries", mapTitle: "Data analyst", evidenceUrl: `/proof/${proofId}` },
      // Proved after the page was published, so the page doesn't show it.
      { title: "SQL joins", mapTitle: "Data analyst", evidenceUrl: null },
    ]);
  });

  it("never link a revoked page, or a page someone else published", async () => {
    const map = await saveMap(ANA, [node("a", "SQL queries")]);
    await prove(map.id, ANA, "a");
    await publishEvidence(map, ANA, ["a"], "revoked");
    expect((await computeSkills(ANA)).proven[0].evidenceUrl).toBeNull();

    await publishEvidence(map, BO, ["a"]);
    expect((await computeSkills(ANA)).proven[0].evidenceUrl).toBeNull();
  });
});

describe("the network view", () => {
  it("finds a mentor who proved what the viewer is learning, with reasons, and no ids", async () => {
    const anasMap = await saveMap(ANA, [node("sql", "SQL queries"), node("joins", "SQL joins", ["sql"])]);
    const bosMap = await saveMap(BO, [node("j", "SQL joins and unions"), node("p", "Python")], "Backend");
    await prove(bosMap.id, BO, "j");
    await joinNetwork(BO, { displayName: "Bo", contactUrl: "https://example.com/bo" });

    const view = await getNetwork(ANA);
    const bo = view.mentors.find((match) => match.profile.displayName === "Bo");
    expect(bo).toBeDefined();
    expect(bo!.mentorFor).toEqual(["SQL joins and unions"]);
    expect(bo!.reasons[0]).toBe("Proved SQL joins and unions, which you're learning.");
    expect(bo!.profile.contactUrl).toBe("https://example.com/bo");
    expect(view.viewerHasMaps).toBe(true);

    const text = JSON.stringify(view);
    for (const secret of [ANA, BO, anasMap.id, bosMap.id, "userId", "ownerId", "mapId", "demo-network-"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("lists everyone without match sections when the viewer has no profile and no maps", async () => {
    const view = await getNetwork(ANA);
    expect(view.me).toBeNull();
    expect(view.viewerHasMaps).toBe(false);
    expect(view.mentors).toEqual([]);
    expect(view.peers).toEqual([]);
    expect(view.everyone).toHaveLength(DEMO_PROFILES.length);
  });

  it("matches the viewer with demo profiles from the sample maps' skills", async () => {
    await saveMap(ANA, [node("sql", "SQL queries"), node("joins", "SQL joins", ["sql"])]);
    const view = await getNetwork(ANA);
    const mentors = view.mentors.map((match) => match.profile.displayName);
    // Priya proved SQL queries and SQL joins; Marcus proved "SQL query writing".
    expect(mentors[0]).toBe("Priya S.");
    expect(mentors).toContain("Marcus T.");
    expect(view.peers.map((match) => match.profile.displayName)).toEqual(
      expect.arrayContaining(["Wei L.", "Diego M."]),
    );
    // Each person shows up once.
    const all = [...view.mentors, ...view.peers, ...view.everyone].map((match) => match.profile);
    expect(new Set(all.map((p) => p.publicId)).size).toBe(all.length);
  });

  it("lists real people before demo profiles", async () => {
    await joinNetwork(BO, { displayName: "Bo" });
    const view = await getNetwork(ANA);
    expect(view.everyone[0].profile).toMatchObject({ displayName: "Bo", isDemo: false });
  });

  it("keeps the reason for someone who only proved the same skill, and lists them first", async () => {
    const anasMap = await saveMap(ANA, [node("q", "Quantum origami")], "Folding");
    const bosMap = await saveMap(BO, [node("q", "Quantum origami")], "Folding");
    await prove(anasMap.id, ANA, "q");
    await prove(bosMap.id, BO, "q");
    await joinNetwork(BO, { displayName: "Bo" });

    const view = await getNetwork(ANA);
    expect(view.mentors.map((match) => match.profile.displayName)).not.toContain("Bo");
    expect(view.peers.map((match) => match.profile.displayName)).not.toContain("Bo");
    expect(view.everyone[0].profile.displayName).toBe("Bo");
    expect(view.everyone[0].score).toBe(1);
    expect(view.everyone[0].reasons).toEqual(["Also proved Quantum origami, like you."]);
  });

  it("works out other people's skills afresh on every listing", async () => {
    const bosMap = await saveMap(BO, [node("a", "SQL queries"), node("b", "Python")], "Backend");
    await prove(bosMap.id, BO, "a");
    const proofId = await publishEvidence(bosMap, BO, ["a"]);
    await joinNetwork(BO, { displayName: "Bo" });
    const bo = (view: Awaited<ReturnType<typeof getNetwork>>) =>
      view.everyone.find((match) => match.profile.displayName === "Bo")!.profile;

    expect(bo(await getNetwork(ANA)).provenSkills).toEqual([
      { title: "SQL queries", mapTitle: "Backend", evidenceUrl: `/proof/${proofId}` },
    ]);

    // Bo proves another skill and revokes his evidence page. The very next listing shows both.
    await prove(bosMap.id, BO, "b");
    await publishEvidence(bosMap, BO, ["a"], "revoked");
    expect(bo(await getNetwork(ANA)).provenSkills).toEqual([
      { title: "SQL queries", mapTitle: "Backend", evidenceUrl: null },
      { title: "Python", mapTitle: "Backend", evidenceUrl: null },
    ]);
  });
});

describe("demo profiles", () => {
  it("are seeded once, labelled, with no contact link, even when seeding runs at once", async () => {
    await Promise.all([ensureDemoProfiles(), ensureDemoProfiles()]);
    resetDemoStateForTests();
    await Promise.all([ensureDemoProfiles(), ensureDemoProfiles()]);

    const demos = (await listProfiles()).filter((profile) => profile.isDemo);
    expect(demos).toHaveLength(DEMO_PROFILES.length);
    for (const demo of demos) {
      expect(demo.contactUrl).toBeNull();
      expect(demo.userId).not.toMatch(/^[0-9a-f-]{36}$/);
      expect(demo.demo?.version).toBe(DEMO_VERSION);
    }
    const view = await getNetwork(ANA);
    expect(view.everyone.every(({ profile }) => profile.isDemo && profile.contactUrl === null)).toBe(true);
  });

  it("keep their public id across seeding runs, and are rewritten once when the list changes", async () => {
    await ensureDemoProfiles();
    const key = profileKey(DEMO_PROFILES[0].userId);
    const before = (await getDoc<ProfileRecord>(key))!;
    await putDoc(key, { ...before, contactUrl: "https://evil.example", demo: { ...before.demo!, version: 0 } });

    resetDemoStateForTests();
    await ensureDemoProfiles();
    const after = (await getDoc<ProfileRecord>(key))!;
    expect(after.publicId).toBe(before.publicId);
    expect(after.contactUrl).toBeNull();
    expect(after.demo?.version).toBe(DEMO_VERSION);
  });
});

describe("deleteUserData", () => {
  it("removes only this person's profile, and can run twice", async () => {
    await joinNetwork(ANA, { displayName: "Ana" });
    await joinNetwork(BO, { displayName: "Bo" });
    expect(await deleteUserData(ANA)).toEqual({ profiles: 1 });
    expect(await deleteUserData(ANA)).toEqual({ profiles: 0 });
    expect(await getDoc(profileKey(ANA))).toBeNull();
    expect(await getDoc(profileKey(BO))).not.toBeNull();
  });

  it("refuses ids that are not UUIDs, so demo profiles and other keys are safe", async () => {
    await ensureDemoProfiles();
    const before = await listKeys("network/");
    expect(await deleteUserData("demo-network-priya")).toEqual({ profiles: 0 });
    expect(await deleteUserData("../maps")).toEqual({ profiles: 0 });
    expect(await deleteUserData("")).toEqual({ profiles: 0 });
    expect(await listKeys("network/")).toEqual(before);
  });
});
