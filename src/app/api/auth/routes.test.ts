/**
 * The auth routes as Next.js calls them: status codes, and that no response carries a
 * user id, the Auth0 subject, a token or a secret. Fake values only; fetch is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, getUserId } from "@/shared/identity";
import { GET as callbackRoute } from "./callback/route";
import { GET as loginRoute } from "./login/route";
import { GET as logoutGetRoute, POST as logoutRoute } from "./logout/route";
import { GET as sessionRoute } from "./session/route";

// connection() needs a real request scope; here every call is a request anyway.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (value === "" || options?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
    delete: (name: string) => jar.delete(name),
  }),
}));

const ENV = {
  AUTH0_DOMAIN: "tenant.example.auth0.com",
  AUTH0_CLIENT_ID: "fake-client-id-123",
  AUTH0_CLIENT_SECRET: "fake-client-secret-do-not-leak-456",
  AUTH0_SECRET: "fake-transaction-secret-0123456789abcdef",
  APP_BASE_URL: "http://localhost:3000",
};
const SUB = "google-oauth2|1098765";
const ID_TOKEN_MARK = "fake-signature-mark";
const fetchMock = vi.fn<typeof fetch>();

function idToken(nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const claims = { iss: `https://${ENV.AUTH0_DOMAIN}/`, aud: ENV.AUTH0_CLIENT_ID, sub: SUB, iat: now, exp: now + 600, nonce, name: "Ana" };
  return `${part({ alg: "RS256" })}.${part(claims)}.${Buffer.from(ID_TOKEN_MARK).toString("base64url")}`;
}

/** Everything a browser could see, checked for anything private. */
async function expectNothingPrivate(response: Response, extra: string[] = []) {
  const seen = [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).join("\n") + (await response.text());
  for (const secret of [ENV.AUTH0_CLIENT_SECRET, ENV.AUTH0_SECRET, SUB, "1098765", "fake-access-token", ID_TOKEN_MARK, ...extra]) {
    expect(seen).not.toContain(secret);
  }
}

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  vi.stubEnv("SESSION_SECRET", "fake-session-secret");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  jar.clear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auth routes", () => {
  it("login, callback, session and logout, with nothing private in any response", async () => {
    const guestId = await getUserId();

    const login = await loginRoute(new Request("http://localhost:3000/api/auth/login?returnTo=/courses"));
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location")!);
    expect(authorize.host).toBe(ENV.AUTH0_DOMAIN);
    await expectNothingPrivate(login, [guestId]);

    fetchMock.mockResolvedValueOnce(
      Response.json({ id_token: idToken(authorize.searchParams.get("nonce")!), access_token: "fake-access-token" }),
    );
    const callback = await callbackRoute(
      new Request(`http://localhost:3000/api/auth/callback?code=c&state=${authorize.searchParams.get("state")}`),
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/courses");
    await expectNothingPrivate(callback, [guestId]);
    expect(await getSession()).toMatchObject({ userId: guestId, signedIn: true });

    const session = await sessionRoute();
    expect(session.status).toBe(200);
    expect(session.headers.get("cache-control")).toBe("no-store");
    expect(await session.clone().json()).toEqual({ available: true, signedIn: true, displayName: "Ana" });
    await expectNothingPrivate(session, [guestId]);

    const logout = await logoutRoute(new Request("http://localhost:3000/api/auth/logout", { method: "POST" }));
    expect(logout.status).toBe(303);
    expect(logout.headers.get("location")).toMatch(/^https:\/\/tenant\.example\.auth0\.com\/v2\/logout\?/);
    await expectNothingPrivate(logout, [guestId]);
    expect((await getSession()).signedIn).toBe(false);
  });

  it("callback with a bogus state goes to /?signin=expired and signs nobody in", async () => {
    const response = await callbackRoute(new Request("http://localhost:3000/api/auth/callback?code=c&state=bogus"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/?signin=expired");
    expect(jar.has("pf_account")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GET logout (a link from any site) goes home and changes no cookie", async () => {
    const guestId = await getUserId();
    const response = await logoutGetRoute(
      new Request("http://localhost:3000/api/auth/logout?returnTo=https://evil.example", { headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(await getUserId()).toBe(guestId);
  });

  it("a cross-site POST to logout changes no cookie", async () => {
    const guestId = await getUserId();
    const response = await logoutRoute(
      new Request("http://localhost:3000/api/auth/logout", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      }),
    );
    expect(response.headers.get("location")).toBe("/");
    expect(await getUserId()).toBe(guestId);
  });

  it("without Auth0, login says unavailable and session says not available", async () => {
    for (const name of Object.keys(ENV)) vi.stubEnv(name, "");
    const login = await loginRoute(new Request("http://localhost:3000/api/auth/login"));
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe("/?signin=unavailable");
    expect(await (await sessionRoute()).json()).toEqual({ available: false, signedIn: false, displayName: null });
  });
});
