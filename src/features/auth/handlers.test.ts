/**
 * The sign-in flow end to end: real identity cookies (in a fake jar per browser), the
 * in-memory store, and a mocked Auth0 token endpoint. Nothing reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, getUserId } from "@/shared/identity";
import { getDoc, listDocs } from "@/shared/store";
import { accountKey, accountOfKey, forgetAccount, subHash, type AccountDoc } from "./accounts";
import { handleCallback, handleLogin, handleLogout, sessionSummary } from "./handlers";
import {
  Browser,
  FAKE_ENV,
  goodClaims,
  makeIdToken,
  newDefaultBrowser,
  resetMemoryStore,
  stubAuthEnv,
  stubNoAuthEnv,
  tokenResponse,
} from "./testing";
import { TX_COOKIE } from "./transaction";

vi.mock("next/headers", async () => (await import("./testing")).nextHeadersMock);

const BASE = "http://localhost:3000";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  stubAuthEnv();
  resetMemoryStore();
  newDefaultBrowser();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Starts a sign-in in the current browser and returns what Auth0 would be sent. */
async function startLogin(query = "returnTo=/courses") {
  const response = await handleLogin(new Request(`${BASE}/api/auth/login?${query}`));
  const location = response.headers.get("location") ?? "";
  const url = new URL(location, BASE);
  return { response, url, state: url.searchParams.get("state") ?? "", nonce: url.searchParams.get("nonce") ?? "" };
}

function callback(query: string) {
  return handleCallback(new Request(`${BASE}/api/auth/callback?${query}`));
}

/** A whole sign-in in the current browser, with Auth0 answering for `sub`. */
async function signIn(claims: Record<string, unknown> = {}) {
  const { state, nonce } = await startLogin();
  fetchMock.mockResolvedValueOnce(tokenResponse(makeIdToken(goodClaims(nonce, claims))));
  return callback(`code=fake-code&state=${state}`);
}

const location = (response: Response) => response.headers.get("location");

describe("login", () => {
  it("redirects to Auth0 and saves a short-lived, signed transaction cookie on /api/auth", async () => {
    const browser = newDefaultBrowser();
    const { response, url } = await startLogin("returnTo=/courses/abc");

    expect(response.status).toBe(302);
    expect(url.origin + url.pathname).toBe(`https://${FAKE_ENV.AUTH0_DOMAIN}/authorize`);
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback`);
    const tx = browser.sets.find((call) => call.name === TX_COOKIE);
    expect(tx?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/auth", maxAge: 600 });
    expect(tx?.value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("uses fresh state, nonce and verifier each time", async () => {
    const first = await startLogin();
    const second = await startLogin();
    expect(second.state).not.toBe(first.state);
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.url.searchParams.get("code_challenge")).not.toBe(first.url.searchParams.get("code_challenge"));
  });

  it("goes back to the original page after signing in, but never off-site", async () => {
    let { state, nonce } = await startLogin("returnTo=%2Fcourses%2Fabc%3Fsort%3Dnew");
    fetchMock.mockResolvedValueOnce(tokenResponse(makeIdToken(goodClaims(nonce))));
    expect(location(await callback(`code=c&state=${state}`))).toBe("/courses/abc?sort=new");

    ({ state, nonce } = await startLogin("returnTo=%2F%2Fevil.example"));
    fetchMock.mockResolvedValueOnce(tokenResponse(makeIdToken(goodClaims(nonce))));
    expect(location(await callback(`code=c&state=${state}`))).toBe("/");
  });

  it("finishes signing in when the return path has characters outside Latin-1", async () => {
    const { state, nonce } = await startLogin("returnTo=%2Fcourses%2F%E4%B8%AD");
    fetchMock.mockResolvedValueOnce(tokenResponse(makeIdToken(goodClaims(nonce))));
    const response = await callback(`code=c&state=${state}`);
    expect(response.status).toBe(303);
    expect(location(response)).toBe("/courses/%E4%B8%AD");
    expect((await getSession()).signedIn).toBe(true);
  });

  it("says sign-in is unavailable when Auth0 is not set up, without throwing", async () => {
    stubNoAuthEnv();
    const response = await handleLogin(new Request(`${BASE}/api/auth/login?returnTo=/courses`));
    expect(response.status).toBe(303);
    expect(location(response)).toBe("/?signin=unavailable");
  });
});

describe("callback failures never sign anyone in", () => {
  async function expectNoSession(response: Response, browser: Browser, expected: string) {
    expect(response.status).toBe(303);
    expect(location(response)).toBe(expected);
    expect(browser.setNames()).not.toContain("pf_account");
    expect((await getSession()).signedIn).toBe(false);
    // The transaction is single use: always deleted.
    expect(browser.jar.has(TX_COOKIE)).toBe(false);
  }

  it("missing cookie", async () => {
    const browser = newDefaultBrowser();
    await expectNoSession(await callback("code=c&state=s"), browser, "/?signin=expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("bad state", async () => {
    const browser = newDefaultBrowser();
    await startLogin();
    await expectNoSession(await callback("code=c&state=not-the-state"), browser, "/?signin=expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a tampered or expired transaction cookie", async () => {
    const browser = newDefaultBrowser();
    const { state } = await startLogin();
    browser.jar.set(TX_COOKIE, `${browser.jar.get(TX_COOKIE)}x`);
    await expectNoSession(await callback(`code=c&state=${state}`), browser, "/?signin=expired");

    const later = await startLogin();
    vi.useFakeTimers({ now: Date.now() + 11 * 60_000 });
    try {
      await expectNoSession(await callback(`code=c&state=${later.state}`), browser, "/?signin=expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an error from Auth0, whose text is never echoed", async () => {
    const browser = newDefaultBrowser();
    const { state } = await startLogin("returnTo=/courses");
    const response = await callback(`error=access_denied&error_description=%3Cscript%3Eevil&state=${state}`);
    await expectNoSession(response, browser, "/courses?signin=failed");
    expect(location(response)).not.toContain("evil");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an error with no transaction goes home", async () => {
    const browser = newDefaultBrowser();
    await expectNoSession(await callback("error=access_denied"), browser, "/?signin=failed");
  });

  it("no code", async () => {
    const browser = newDefaultBrowser();
    const { state } = await startLogin();
    await expectNoSession(await callback(`state=${state}`), browser, "/courses?signin=failed");
  });

  it("the token endpoint answers non-200", async () => {
    const browser = newDefaultBrowser();
    const { state } = await startLogin();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await expectNoSession(await callback(`code=c&state=${state}`), browser, "/courses?signin=failed");
  });

  it("the token endpoint times out", async () => {
    const browser = newDefaultBrowser();
    const { state } = await startLogin();
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expectNoSession(await callback(`code=c&state=${state}`), browser, "/courses?signin=failed");
  });

  it.each([
    ["wrong iss", { iss: "https://evil.example/" }],
    ["wrong aud", { aud: "someone-else" }],
    ["wrong azp", { azp: "someone-else" }],
    ["wrong nonce", { nonce: "replayed" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["missing sub", { sub: undefined }],
  ])("an id_token with %s", async (_label, change) => {
    const browser = newDefaultBrowser();
    const { state, nonce } = await startLogin();
    fetchMock.mockResolvedValueOnce(tokenResponse(makeIdToken({ ...goodClaims(nonce), ...change })));
    await expectNoSession(await callback(`code=c&state=${state}`), browser, "/courses?signin=failed");
    expect(await listDocs("accounts/")).toEqual([]);
  });

  it("a state replayed after a successful sign-in", async () => {
    const browser = newDefaultBrowser();
    const { state, nonce } = await startLogin();
    fetchMock.mockResolvedValueOnce(tokenResponse(makeIdToken(goodClaims(nonce))));
    await callback(`code=c&state=${state}`);
    const replay = await callback(`code=c&state=${state}`);
    expect(location(replay)).toBe("/?signin=expired");
    expect(browser.jar.has(TX_COOKIE)).toBe(false);
  });

  it("Auth0 not set up at the callback", async () => {
    const browser = newDefaultBrowser();
    stubNoAuthEnv();
    await expectNoSession(await callback("code=c&state=s"), browser, "/?signin=unavailable");
  });
});

describe("account linking", () => {
  it("links a new account to the current guest id and signs in with the display name", async () => {
    const guestId = await getUserId();
    const response = await signIn({ name: "Ana Lopez" });

    expect(location(response)).toBe("/courses");
    expect(await getSession()).toEqual({ userId: guestId, signedIn: true, displayName: "Ana Lopez" });
    const doc = await getDoc<AccountDoc>(accountKey(subHash("auth0|user-one")));
    expect(doc).toMatchObject({ userId: guestId, sub: "auth0|user-one" });
    expect(await getDoc(accountOfKey(guestId))).toEqual({ subHash: subHash("auth0|user-one") });
  });

  it("never stores the email, a token or the raw sub in a key", async () => {
    await getUserId();
    await signIn({ email: "private@example.com", name: "private@example.com" });
    const store = (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore!;
    for (const [key, value] of store) {
      expect(key).not.toContain("auth0|user-one");
      expect(value).not.toContain("private@example.com");
      expect(value).not.toContain("example.com");
      expect(value).not.toContain("fake-access-token");
    }
    expect((await getSession()).displayName).toBe("private");
  });

  it("gives a guest with no cookie a fresh id and links it", async () => {
    const browser = newDefaultBrowser();
    await signIn();
    const session = await getSession();
    expect(session.signedIn).toBe(true);
    expect(browser.setNames()).toEqual(expect.arrayContaining(["pf_uid", "pf_account"]));
  });

  it("a second browser signing into the same account gets the same user id", async () => {
    const laptop = new Browser();
    const phone = new Browser();
    const laptopId = await laptop.run(async () => {
      const id = await getUserId();
      await signIn();
      return id;
    });
    const phoneSession = await phone.run(async () => {
      const phoneGuest = await getUserId();
      expect(phoneGuest).not.toBe(laptopId);
      await signIn();
      return getSession();
    });
    expect(phoneSession).toMatchObject({ userId: laptopId, signedIn: true });
  });

  it("a browser already linked to account A that signs into account B gets a new id, not A's", async () => {
    const browser = newDefaultBrowser();
    const idA = await getUserId();
    await signIn({ sub: "auth0|account-a" });
    expect((await getSession()).userId).toBe(idA);

    await signIn({ sub: "auth0|account-b", name: "Bo" });
    const session = await getSession();
    expect(session.signedIn).toBe(true);
    expect(session.userId).not.toBe(idA);
    expect(session.displayName).toBe("Bo");
    expect(browser.jar.has("pf_account")).toBe(true);

    // And signing back into A returns A's id.
    await signIn({ sub: "auth0|account-a" });
    expect((await getSession()).userId).toBe(idA);
  });

  it("two first sign-ins to one account at once end with one user id", async () => {
    const browsers = [new Browser(), new Browser(), new Browser()];
    const logins = await Promise.all(browsers.map((browser) => browser.run(() => startLogin())));
    // Hold every token answer until all three have asked, so the three links run in lockstep.
    let release: () => void = () => {};
    const allAsked = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    fetchMock.mockImplementation(async (_url, init) => {
      if (++asked === browsers.length) release();
      await allAsked;
      // Answer each browser with its own nonce, found from the code it sent.
      const code = new URLSearchParams(init?.body as URLSearchParams).get("code") ?? "";
      return tokenResponse(makeIdToken(goodClaims(logins[Number(code)].nonce, { sub: "auth0|racer" })));
    });
    const sessions = await Promise.all(
      browsers.map((browser, index) =>
        browser.run(async () => {
          await callback(`code=${index}&state=${logins[index].state}`);
          return getSession();
        }),
      ),
    );
    const ids = new Set(sessions.map((session) => session.userId));
    expect(ids.size).toBe(1);
    expect(sessions.every((session) => session.signedIn)).toBe(true);
    expect(await listDocs("accounts/")).toHaveLength(1);
  });
});

describe("logout", () => {
  it("clears the session, starts a fresh guest and signs out of Auth0, returning to the base URL", async () => {
    const browser = newDefaultBrowser();
    await signIn();
    const signedInId = (await getSession()).userId;

    const response = await handleLogout(new Request(`${BASE}/api/auth/logout`, { method: "POST" }));
    expect(response.status).toBe(303);
    const url = new URL(location(response)!);
    expect(url.origin + url.pathname).toBe(`https://${FAKE_ENV.AUTH0_DOMAIN}/v2/logout`);
    expect(url.searchParams.get("returnTo")).toBe(BASE);
    expect(url.searchParams.get("client_id")).toBe(FAKE_ENV.AUTH0_CLIENT_ID);

    const session = await getSession();
    expect(session.signedIn).toBe(false);
    expect(session.userId).not.toBe(signedInId);
    expect(browser.jar.has("pf_account")).toBe(false);
  });

  it("ignores any returnTo in the request", async () => {
    const response = await handleLogout(new Request(`${BASE}/api/auth/logout?returnTo=https://evil.example`));
    expect(location(response)).not.toContain("evil");
  });

  it("still signs out locally when Auth0 is not set up", async () => {
    await signIn();
    const signedInId = (await getSession()).userId;
    stubNoAuthEnv();
    const response = await handleLogout(new Request(`${BASE}/api/auth/logout`, { method: "POST" }));
    expect(location(response)).toBe("/");
    expect(await getSession()).toMatchObject({ signedIn: false });
    expect((await getSession()).userId).not.toBe(signedInId);
  });

  it("signs out a same-origin form post, as browsers send it", async () => {
    const browser = newDefaultBrowser();
    await signIn();
    const response = await handleLogout(
      new Request(`${BASE}/api/auth/logout`, { method: "POST", headers: { "sec-fetch-site": "same-origin", origin: BASE } }),
    );
    expect(new URL(location(response)!).host).toBe(FAKE_ENV.AUTH0_DOMAIN);
    expect(browser.jar.has("pf_account")).toBe(false);
  });

  it("accepts a matching Origin from a browser that sends no Sec-Fetch-Site", async () => {
    await signIn();
    await handleLogout(new Request(`${BASE}/api/auth/logout`, { method: "POST", headers: { origin: BASE } }));
    expect((await getSession()).signedIn).toBe(false);
  });

  it("a guest keeps their id: there is nothing to sign out of", async () => {
    for (const setup of [stubAuthEnv, stubNoAuthEnv]) {
      setup();
      const browser = newDefaultBrowser();
      const guestId = await getUserId();
      const response = await handleLogout(new Request(`${BASE}/api/auth/logout`, { method: "POST" }));
      expect(location(response)).toBe("/");
      expect(await getUserId()).toBe(guestId);
      expect(browser.sets.filter((call) => call.name === "pf_uid")).toHaveLength(1);
    }
  });

  it.each([
    ["a cross-site form post", { method: "POST", headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } }],
    ["a same-site (sibling subdomain) post", { method: "POST", headers: { "sec-fetch-site": "same-site" } }],
    ["a post from another origin, without Sec-Fetch-Site", { method: "POST", headers: { origin: "https://evil.example" } }],
    ["a post with Origin null", { method: "POST", headers: { origin: "null" } }],
    ["a top-level GET from another site", { method: "GET", headers: { "sec-fetch-site": "cross-site" } }],
    ["a plain GET", { method: "GET" }],
  ])("%s changes no cookie, for a guest or a signed-in user", async (_label, init: RequestInit) => {
    for (const signedIn of [false, true]) {
      const browser = newDefaultBrowser();
      if (signedIn) await signIn();
      else await getUserId();
      const before = new Map(browser.jar);
      const setsBefore = browser.sets.length;

      const response = await handleLogout(new Request(`${BASE}/api/auth/logout`, init));
      expect(response.status).toBe(303);
      expect(location(response)).toBe("/");
      expect(browser.sets.length).toBe(setsBefore);
      expect(browser.jar.get("pf_uid")).toBe(before.get("pf_uid"));
      expect((await getSession()).signedIn).toBe(signedIn);
    }
  });
});

describe("forgetAccount", () => {
  it("removes both links, so the next sign-in links afresh", async () => {
    const guestId = await getUserId();
    await signIn();
    await forgetAccount(guestId);
    expect(await getDoc(accountKey(subHash("auth0|user-one")))).toBeNull();
    expect(await getDoc(accountOfKey(guestId))).toBeNull();

    const other = new Browser();
    const otherId = await other.run(async () => {
      const id = await getUserId();
      await signIn();
      return (await getSession()).userId === id ? id : null;
    });
    expect(otherId).not.toBeNull();
    expect(otherId).not.toBe(guestId);
  });

  it("does nothing for an id that is not linked or not a UUID", async () => {
    await expect(forgetAccount("11111111-1111-4111-8111-111111111111")).resolves.toBeUndefined();
    await expect(forgetAccount("../../x")).resolves.toBeUndefined();
  });
});

describe("sessionSummary", () => {
  it("says whether sign-in exists and who is signed in, never the id", async () => {
    expect(await sessionSummary()).toEqual({ available: true, signedIn: false, displayName: null });
    await signIn({ name: "Ana" });
    const summary = await sessionSummary();
    expect(summary).toEqual({ available: true, signedIn: true, displayName: "Ana" });
    expect(JSON.stringify(summary)).not.toContain((await getSession()).userId!);

    stubNoAuthEnv();
    expect(await sessionSummary()).toEqual({ available: false, signedIn: false, displayName: null });
  });
});
