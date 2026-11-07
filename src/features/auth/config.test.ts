import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authConfig, isAuthConfigured } from "./config";
import { FAKE_ENV, stubAuthEnv, stubNoAuthEnv } from "./testing";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authConfig", () => {
  it("reads the five values", () => {
    stubAuthEnv();
    expect(authConfig()).toEqual({
      domain: FAKE_ENV.AUTH0_DOMAIN,
      clientId: FAKE_ENV.AUTH0_CLIENT_ID,
      clientSecret: FAKE_ENV.AUTH0_CLIENT_SECRET,
      secret: FAKE_ENV.AUTH0_SECRET,
      baseUrl: "http://localhost:3000",
    });
    expect(isAuthConfigured()).toBe(true);
  });

  it("is off, without throwing, when nothing is set", () => {
    stubNoAuthEnv();
    expect(authConfig()).toBeNull();
    expect(isAuthConfigured()).toBe(false);
  });

  it.each([
    ["https://tenant.example.auth0.com"],
    ["tenant.example.auth0.com/"],
    ["tenant.example.auth0.com/path"],
    ["tenant example"],
  ])("rejects AUTH0_DOMAIN %s", (domain) => {
    stubAuthEnv({ AUTH0_DOMAIN: domain });
    expect(authConfig()).toBeNull();
    expect(isAuthConfigured()).toBe(false);
  });

  it("rejects a short AUTH0_SECRET", () => {
    stubAuthEnv({ AUTH0_SECRET: "short" });
    expect(isAuthConfigured()).toBe(false);
  });

  it("rejects a missing client id or secret", () => {
    stubAuthEnv({ AUTH0_CLIENT_ID: "" });
    expect(isAuthConfigured()).toBe(false);
    stubAuthEnv({ AUTH0_CLIENT_SECRET: "" });
    expect(isAuthConfigured()).toBe(false);
  });

  it("drops a trailing slash from APP_BASE_URL and rejects one with a path", () => {
    stubAuthEnv({ APP_BASE_URL: "https://oryxlearn.vercel.app/" });
    expect(authConfig()?.baseUrl).toBe("https://oryxlearn.vercel.app");
    stubAuthEnv({ APP_BASE_URL: "https://oryxlearn.vercel.app/app" });
    expect(authConfig()).toBeNull();
    expect(isAuthConfigured()).toBe(false);
  });

  it("uses the request's origin when APP_BASE_URL is not set", () => {
    stubAuthEnv({ APP_BASE_URL: "" });
    expect(authConfig(new Request("http://localhost:4351/api/auth/login"))?.baseUrl).toBe("http://localhost:4351");
    expect(authConfig()).toBeNull();
    expect(isAuthConfigured()).toBe(true);
  });

  it("never logs a value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubAuthEnv({ AUTH0_DOMAIN: "https://secret-looking-domain.example", AUTH0_SECRET: "tiny" });
    authConfig();
    stubAuthEnv({ AUTH0_SECRET: "tiny" });
    authConfig();
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret-looking-domain");
    expect(logged).not.toContain("tiny");
    expect(logged).not.toContain(FAKE_ENV.AUTH0_CLIENT_SECRET);
  });
});
