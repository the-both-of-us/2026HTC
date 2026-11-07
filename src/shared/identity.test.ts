import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, getSession, getUserId, readUserId, setSessionUser } from "./identity";

const cookieJar = new Map<string, string>();
const setCookie = vi.fn((name: string, value: string) => {
  cookieJar.set(name, value);
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: setCookie,
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

const SECRET = "test-secret";
const SOME_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function signedWith(secret: string, cookieName: string, value: string): string {
  const signature = createHmac("sha256", secret).update(`${cookieName}:${value}`).digest("base64url");
  return `${value}.${signature}`;
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  cookieJar.clear();
  setCookie.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getUserId", () => {
  it("creates an httpOnly, SameSite=Lax, one year cookie holding a signed id", async () => {
    const id = await getUserId();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(setCookie).toHaveBeenCalledWith(
      "pf_uid",
      signedWith(SECRET, "pf_uid", id),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 31536000, path: "/" }),
    );
  });

  it("returns the existing id without setting the cookie again", async () => {
    const first = await getUserId();
    setCookie.mockClear();

    expect(await getUserId()).toBe(first);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("replaces a cookie that is not a UUID", async () => {
    cookieJar.set("pf_uid", signedWith(SECRET, "pf_uid", "../../someone-else"));

    const id = await getUserId();

    expect(id).not.toContain("..");
    expect(setCookie).toHaveBeenCalledOnce();
  });
});

describe("readUserId", () => {
  it("returns null and never sets a cookie when there is none", async () => {
    expect(await readUserId()).toBeNull();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("accepts a correctly signed id", async () => {
    cookieJar.set("pf_uid", signedWith(SECRET, "pf_uid", SOME_ID));

    expect(await readUserId()).toBe(SOME_ID);
  });

  it.each([
    ["an unsigned id", SOME_ID],
    ["an empty signature", `${SOME_ID}.`],
    ["a made-up signature", `${SOME_ID}.bm90LWEtcmVhbC1zaWduYXR1cmU`],
    ["another id with a stolen signature", `${OTHER_ID}.${signedWith(SECRET, "pf_uid", SOME_ID).split(".")[1]}`],
    ["a signature from another secret", signedWith("other-secret", "pf_uid", SOME_ID)],
    ["a signature meant for the account cookie", signedWith(SECRET, "pf_account", SOME_ID)],
  ])("treats %s as no cookie", async (_name, value) => {
    cookieJar.set("pf_uid", value);

    expect(await readUserId()).toBeNull();
  });
});

describe("the secret", () => {
  it("falls back to a fixed development secret outside production", async () => {
    vi.stubEnv("SESSION_SECRET", "");

    const id = await getUserId();

    expect(await readUserId()).toBe(id);
  });

  it("in production without a secret, logs an error and accepts no cookie", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    cookieJar.set("pf_uid", SOME_ID);

    expect(await readUserId()).toBeNull();
    cookieJar.set("pf_uid", signedWith("oryxlearn-development-only-secret", "pf_uid", SOME_ID));
    expect(await readUserId()).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("SESSION_SECRET"));
  });

  it("in production without a secret, refuses to issue an id, with a readable error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    await expect(getUserId()).rejects.toMatchObject({ status: 503 });
    expect(setCookie).not.toHaveBeenCalled();
  });
});

describe("sessions", () => {
  it("a guest is not signed in", async () => {
    const id = await getUserId();

    expect(await getSession()).toEqual({ userId: id, signedIn: false, displayName: null });
  });

  it("a visitor with no cookie has no id, and reading it sets nothing", async () => {
    expect(await getSession()).toEqual({ userId: null, signedIn: false, displayName: null });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("after sign-in, the session holds that user and name", async () => {
    await setSessionUser(SOME_ID, { displayName: "Ada" });

    expect(await getSession()).toEqual({ userId: SOME_ID, signedIn: true, displayName: "Ada" });
    expect(await getUserId()).toBe(SOME_ID);
  });

  it("ignores an account cookie that was edited", async () => {
    await setSessionUser(SOME_ID, { displayName: "Ada" });
    const forged = Buffer.from(JSON.stringify({ userId: SOME_ID, displayName: "Mallory" })).toString("base64url");
    cookieJar.set("pf_account", `${forged}.${cookieJar.get("pf_account")!.split(".")[1]}`);

    expect(await getSession()).toEqual({ userId: SOME_ID, signedIn: false, displayName: null });
  });

  it("ignores an account cookie issued for a different user id", async () => {
    await setSessionUser(SOME_ID, { displayName: "Ada" });
    cookieJar.set("pf_uid", signedWith(SECRET, "pf_uid", OTHER_ID));

    expect(await getSession()).toEqual({ userId: OTHER_ID, signedIn: false, displayName: null });
  });

  it("refuses a user id that is not a UUID", async () => {
    await expect(setSessionUser("../../x", { displayName: "Ada" })).rejects.toThrow();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("signing out gives a fresh guest id, signed, with no account", async () => {
    await setSessionUser(SOME_ID, { displayName: "Ada" });

    const fresh = await clearSession();

    expect(fresh).not.toBe(SOME_ID);
    expect(await getSession()).toEqual({ userId: fresh, signedIn: false, displayName: null });
  });
});
