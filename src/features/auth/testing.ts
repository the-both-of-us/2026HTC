/**
 * Test helpers. Not exported from index.ts. Every value here is fake: tests never read
 * the real environment and never reach Auth0.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { vi } from "vitest";

export const FAKE_ENV = {
  AUTH0_DOMAIN: "tenant.example.auth0.com",
  AUTH0_CLIENT_ID: "fake-client-id-123",
  AUTH0_CLIENT_SECRET: "fake-client-secret-do-not-leak-456",
  AUTH0_SECRET: "fake-transaction-secret-0123456789abcdef",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: "fake-session-secret",
} as const;

export function stubAuthEnv(overrides: Partial<Record<keyof typeof FAKE_ENV, string>> = {}): void {
  for (const [name, value] of Object.entries({ ...FAKE_ENV, ...overrides })) vi.stubEnv(name, value);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
}

/** Sign-in turned off: none of the Auth0 values set. */
export function stubNoAuthEnv(): void {
  for (const name of ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("SESSION_SECRET", FAKE_ENV.SESSION_SECRET);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
}

export function resetMemoryStore(): void {
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
}

type CookieOptions = { path?: string; maxAge?: number; httpOnly?: boolean; sameSite?: string; secure?: boolean };
export type SetCall = { name: string; value: string; options?: CookieOptions };

/** One browser's cookies, and every cookie the server set on it. */
export class Browser {
  readonly jar = new Map<string, string>();
  readonly sets: SetCall[] = [];

  run<T>(work: () => Promise<T>): Promise<T> {
    return browsers.run(this, work);
  }

  /** Names of cookies the server set to a non-empty value. */
  setNames(): string[] {
    return this.sets.filter((call) => call.value !== "" && call.options?.maxAge !== 0).map((call) => call.name);
  }
}

const browsers = new AsyncLocalStorage<Browser>();
let defaultBrowser = new Browser();

/** A fresh default browser for code run outside Browser.run. */
export function newDefaultBrowser(): Browser {
  defaultBrowser = new Browser();
  return defaultBrowser;
}

function currentBrowser(): Browser {
  return browsers.getStore() ?? defaultBrowser;
}

/** Use as: vi.mock("next/headers", async () => (await import("./testing")).nextHeadersMock) */
export const nextHeadersMock = {
  cookies: async () => {
    const browser = currentBrowser();
    return {
      get: (name: string) => {
        const value = browser.jar.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string, options?: CookieOptions) => {
        browser.sets.push({ name, value, options });
        if (value === "" || options?.maxAge === 0) browser.jar.delete(name);
        else browser.jar.set(name, value);
      },
      delete: (name: string) => {
        browser.sets.push({ name, value: "", options: { maxAge: 0 } });
        browser.jar.delete(name);
      },
    };
  },
};

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A token shaped like Auth0's, with fake claims and a fake signature. */
export function makeIdToken(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", typ: "JWT" }): string {
  return `${segment(header)}.${segment(claims)}.ZmFrZS1zaWduYXR1cmU`;
}

/** Valid claims for the fake tenant, with the given nonce. */
export function goodClaims(nonce: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `https://${FAKE_ENV.AUTH0_DOMAIN}/`,
    aud: FAKE_ENV.AUTH0_CLIENT_ID,
    sub: "auth0|user-one",
    iat: now,
    exp: now + 3600,
    nonce,
    name: "Ana Lopez",
    email: "ana@example.com",
    ...extra,
  };
}

export function tokenResponse(idToken: string, status = 200): Response {
  return new Response(JSON.stringify({ id_token: idToken, access_token: "fake-access-token", token_type: "Bearer" }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
