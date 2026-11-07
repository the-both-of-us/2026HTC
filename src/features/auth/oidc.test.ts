import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authConfig, type AuthConfig } from "./config";
import { authorizeUrl, codeChallenge, exchangeCode, logoutUrl, randomToken, validateIdToken } from "./oidc";
import { FAKE_ENV, goodClaims, makeIdToken, stubAuthEnv, tokenResponse } from "./testing";

let config: AuthConfig;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  stubAuthEnv();
  config = authConfig()!;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("randomToken and codeChallenge", () => {
  it("makes 43 character base64url tokens that differ every time", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it("is base64url(sha256(verifier))", () => {
    // RFC 7636, appendix B.
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("authorizeUrl", () => {
  it("asks for an S256 PKCE code with state and nonce, and holds no secret", () => {
    const verifier = randomToken();
    const url = new URL(authorizeUrl(config, { state: "the-state", nonce: "the-nonce", verifier }));

    expect(url.origin).toBe(`https://${FAKE_ENV.AUTH0_DOMAIN}`);
    expect(url.pathname).toBe("/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: FAKE_ENV.AUTH0_CLIENT_ID,
      redirect_uri: "http://localhost:3000/api/auth/callback",
      scope: "openid profile email",
      state: "the-state",
      nonce: "the-nonce",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    expect(url.toString()).not.toContain(FAKE_ENV.AUTH0_CLIENT_SECRET);
    expect(url.toString()).not.toContain(FAKE_ENV.AUTH0_SECRET);
    expect(url.toString()).not.toContain(verifier);
  });

  it("passes only allowlisted connections", () => {
    const base = { state: "s", nonce: "n", verifier: "v" };
    expect(new URL(authorizeUrl(config, { ...base, connection: "google-oauth2" })).searchParams.get("connection")).toBe(
      "google-oauth2",
    );
    expect(
      new URL(authorizeUrl(config, { ...base, connection: "Username-Password-Authentication" })).searchParams.get("connection"),
    ).toBe("Username-Password-Authentication");
    expect(new URL(authorizeUrl(config, { ...base, connection: "evil-saml" })).searchParams.has("connection")).toBe(false);
  });
});

describe("logoutUrl", () => {
  it("returns to the site's base URL, built from config only", () => {
    const url = new URL(logoutUrl(config));
    expect(url.origin + url.pathname).toBe(`https://${FAKE_ENV.AUTH0_DOMAIN}/v2/logout`);
    expect(url.searchParams.get("client_id")).toBe(FAKE_ENV.AUTH0_CLIENT_ID);
    expect(url.searchParams.get("returnTo")).toBe("http://localhost:3000");
  });
});

describe("exchangeCode", () => {
  it("posts the code, verifier and client credentials as a form, with a timeout", async () => {
    fetchMock.mockResolvedValue(tokenResponse("a.b.c"));
    expect(await exchangeCode(config, { code: "the-code", verifier: "the-verifier" })).toBe("a.b.c");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://${FAKE_ENV.AUTH0_DOMAIN}/oauth/token`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code",
      client_id: FAKE_ENV.AUTH0_CLIENT_ID,
      client_secret: FAKE_ENV.AUTH0_CLIENT_SECRET,
      code: "the-code",
      code_verifier: "the-verifier",
      redirect_uri: "http://localhost:3000/api/auth/callback",
    });
  });

  it("returns null for a non-200, a missing id_token, bad JSON, a timeout or a network error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 403 }));
    expect(await exchangeCode(config, { code: "c", verifier: "v" })).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "x" }), { status: 200 }));
    expect(await exchangeCode(config, { code: "c", verifier: "v" })).toBeNull();

    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    expect(await exchangeCode(config, { code: "c", verifier: "v" })).toBeNull();

    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await exchangeCode(config, { code: "c", verifier: "v" })).toBeNull();

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await exchangeCode(config, { code: "c", verifier: "v" })).toBeNull();
  });

  it("never logs the secret or the response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error_description: "echo-me" }), { status: 401 }));
    await exchangeCode(config, { code: "the-code", verifier: "v" });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain(FAKE_ENV.AUTH0_CLIENT_SECRET);
    expect(logged).not.toContain("echo-me");
    expect(logged).not.toContain("the-code");
  });
});

describe("validateIdToken", () => {
  const NONCE = "expected-nonce";
  const check = (claims: Record<string, unknown>, header?: Record<string, unknown>) =>
    validateIdToken(makeIdToken(claims, header), { config, nonce: NONCE });

  it("accepts good claims and returns only sub and the name fields", () => {
    expect(check(goodClaims(NONCE, { nickname: "ana" }))).toEqual({
      sub: "auth0|user-one",
      name: "Ana Lopez",
      nickname: "ana",
      email: "ana@example.com",
    });
  });

  it("accepts an audience array that names us, with azp", () => {
    expect(check(goodClaims(NONCE, { aud: [FAKE_ENV.AUTH0_CLIENT_ID, "other"], azp: FAKE_ENV.AUTH0_CLIENT_ID }))).not.toBeNull();
  });

  it.each([
    ["wrong issuer", { iss: "https://evil.example/" }],
    ["issuer without the slash", { iss: `https://${FAKE_ENV.AUTH0_DOMAIN}` }],
    ["wrong audience", { aud: "someone-else" }],
    ["audience array without us", { aud: ["a", "b"], azp: "a" }],
    ["several audiences and no azp", { aud: [FAKE_ENV.AUTH0_CLIENT_ID, "other"] }],
    ["wrong azp", { azp: "someone-else" }],
    ["wrong nonce", { nonce: "another-nonce" }],
    ["missing nonce", { nonce: undefined }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 120 }],
    ["missing exp", { exp: undefined }],
    ["issued in the future", { iat: Math.floor(Date.now() / 1000) + 600 }],
    ["missing sub", { sub: undefined }],
    ["empty sub", { sub: "" }],
    ["non-string sub", { sub: 12 }],
  ])("rejects a token with %s", (_label, change) => {
    expect(check({ ...goodClaims(NONCE), ...change })).toBeNull();
  });

  it("allows a minute of clock skew on exp", () => {
    expect(check(goodClaims(NONCE, { exp: Math.floor(Date.now() / 1000) - 30 }))).not.toBeNull();
  });

  it("rejects alg none and malformed tokens", () => {
    expect(check(goodClaims(NONCE), { alg: "none" })).toBeNull();
    expect(validateIdToken("not-a-jwt", { config, nonce: NONCE })).toBeNull();
    expect(validateIdToken("a.b", { config, nonce: NONCE })).toBeNull();
    expect(validateIdToken("e30.bm90IGpzb24.sig", { config, nonce: NONCE })).toBeNull();
  });
});
