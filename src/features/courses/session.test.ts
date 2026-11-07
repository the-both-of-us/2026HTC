/**
 * The sign-in seam: with Auth0 set up, publishing and liking need a signed-in session;
 * without it (tests, offline development), guests may do both. Real identity cookies in a
 * fake jar, the in-memory store, and fake Auth0 values only.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@/shared/identity";
import { getCourse, publishCourse, unpublishCourse } from "./courses";
import { CoursesError } from "./errors";
import { likeCourse, unlikeCourse } from "./likes";
import { requireLearner, requireLiker, requirePublisher, SIGN_IN_TO_LIKE, SIGN_IN_TO_PUBLISH } from "./session";
import { resetStore, saveMap } from "./testing";

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

const OWNER = randomUUID();
const FAN = randomUUID();

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
    if (!(error instanceof CoursesError)) throw error;
    return { status: error.status, message: error.message };
  }
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("SESSION_SECRET", "fake-session-secret");
  resetStore();
  jar.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("without Auth0", () => {
  beforeEach(() => stubAuth(false));

  it("lets guests publish, like and start", async () => {
    await expect(requirePublisher(OWNER)).resolves.toBeUndefined();
    await expect(requireLiker(FAN)).resolves.toBeUndefined();
    expect(() => requireLearner(FAN)).not.toThrow();

    const map = await saveMap(OWNER);
    await publishCourse(map.id, OWNER, "Ana");
    expect(await likeCourse(map.id, FAN)).toEqual({ liked: true, likeCount: 1 });
  });

  it("tells the page no sign-in is needed", async () => {
    const map = await saveMap(OWNER);
    expect(await getCourse(map.id, OWNER)).toMatchObject({ signedIn: false, signInRequired: false, displayName: null });
  });

  it("still checks the id", async () => {
    expect(await statusOf(requirePublisher("not-a-uuid"))).toMatchObject({ status: 400 });
  });
});

describe("with Auth0", () => {
  beforeEach(() => stubAuth(true));

  it("refuses a guest publisher and liker with a 401 sentence", async () => {
    expect(await statusOf(requirePublisher(OWNER))).toEqual({ status: 401, message: SIGN_IN_TO_PUBLISH });
    expect(await statusOf(requireLiker(FAN))).toEqual({ status: 401, message: SIGN_IN_TO_LIKE });
    expect(SIGN_IN_TO_PUBLISH).toBe("Sign in to publish a course, so your name shows on it.");
    expect(SIGN_IN_TO_LIKE).toBe("Sign in to like courses.");
  });

  it("lets a guest still start a course", () => {
    expect(() => requireLearner(FAN)).not.toThrow();
  });

  it("allows the signed-in user, and only as themselves", async () => {
    await setSessionUser(OWNER, { displayName: "Ana" });
    await expect(requirePublisher(OWNER)).resolves.toBeUndefined();
    await expect(requireLiker(OWNER)).resolves.toBeUndefined();
    expect(await statusOf(requirePublisher(FAN))).toMatchObject({ status: 401 });
  });

  it("publishCourse: guest gets 401, signed in publishes", async () => {
    const map = await saveMap(OWNER);
    expect(await statusOf(publishCourse(map.id, OWNER, "Ana"))).toEqual({ status: 401, message: SIGN_IN_TO_PUBLISH });

    await setSessionUser(OWNER, { displayName: "Ana" });
    expect(await statusOf(publishCourse(map.id, OWNER, "Ana"))).toBe("ok");
  });

  it("a guest owner can still make their course private", async () => {
    const map = await saveMap(OWNER);
    await setSessionUser(OWNER, { displayName: "Ana" });
    await publishCourse(map.id, OWNER, "Ana");
    jar.delete("pf_account");

    expect(await statusOf(unpublishCourse(map.id, OWNER))).toBe("ok");
  });

  it("likeCourse and unlikeCourse: guest gets 401, signed in likes", async () => {
    const map = await saveMap(OWNER);
    await setSessionUser(OWNER, { displayName: "Ana" });
    await publishCourse(map.id, OWNER, "Ana");
    jar.clear();

    expect(await statusOf(likeCourse(map.id, FAN))).toEqual({ status: 401, message: SIGN_IN_TO_LIKE });
    expect(await statusOf(unlikeCourse(map.id, FAN))).toMatchObject({ status: 401 });

    await setSessionUser(FAN, { displayName: "Fan" });
    expect(await likeCourse(map.id, FAN)).toEqual({ liked: true, likeCount: 1 });
  });

  it("getCourse tells a guest to sign in, and gives a signed-in viewer only their own name", async () => {
    const map = await saveMap(OWNER);
    expect(await getCourse(map.id, OWNER)).toMatchObject({ signedIn: false, signInRequired: true, displayName: null });

    await setSessionUser(OWNER, { displayName: "Ana" });
    const detail = await getCourse(map.id, OWNER);
    expect(detail).toMatchObject({ signedIn: true, signInRequired: false, displayName: "Ana" });
    expect(JSON.stringify(detail)).not.toContain(OWNER);
  });
});
