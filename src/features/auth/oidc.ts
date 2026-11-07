/**
 * OpenID Connect against Auth0, by hand: Authorization Code flow with PKCE (S256).
 * No SDK and no JWT library: fetch and node:crypto only.
 */
import { createHash, randomBytes } from "node:crypto";
import type { AuthConfig } from "./config";
import { safeEqual } from "./transaction";

export const SCOPE = "openid profile email";
/** Connections a login link may ask for. Anything else is ignored and Auth0 shows its own choice. */
export const ALLOWED_CONNECTIONS = ["google-oauth2", "Username-Password-Authentication"] as const;
const TOKEN_TIMEOUT_MS = 10_000;
/** Allowed clock drift between us and Auth0 when checking exp and iat. */
const CLOCK_SKEW_SECONDS = 60;
const MAX_SUB_LENGTH = 255;

/** 32 random bytes as base64url: 43 characters. Used for state, nonce and the PKCE verifier. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The PKCE S256 challenge: base64url(sha256(verifier)). */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function callbackUrl(config: AuthConfig): string {
  return `${config.baseUrl}/api/auth/callback`;
}

/** Returns the connection if it is on the allowlist, otherwise null. */
export function allowedConnection(value: string | null): string | null {
  return (ALLOWED_CONNECTIONS as readonly string[]).includes(value ?? "") ? value : null;
}

/** The Auth0 /authorize URL. It holds no secret: only the client id and one-time values. */
export function authorizeUrl(
  config: AuthConfig,
  { state, nonce, verifier, connection }: { state: string; nonce: string; verifier: string; connection?: string | null },
): string {
  const url = new URL(`https://${config.domain}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(config));
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  const allowed = allowedConnection(connection ?? null);
  if (allowed) url.searchParams.set("connection", allowed);
  return url.toString();
}

/** Auth0's logout URL. Only built from config, so it can't be turned into an open redirect. */
export function logoutUrl(config: AuthConfig): string {
  const url = new URL(`https://${config.domain}/v2/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("returnTo", config.baseUrl);
  return url.toString();
}

/**
 * Swaps the authorization code for tokens at Auth0's token endpoint, authenticating with
 * the client secret in the body (client_secret_post, Auth0's default for a Regular Web App).
 * Returns the id_token, or null on any failure. The reason goes to the log, never the page,
 * and never the token or secret.
 */
export async function exchangeCode(
  config: AuthConfig,
  { code, verifier }: { code: string; verifier: string },
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: callbackUrl(config),
  });
  try {
    const response = await fetch(`https://${config.domain}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn(`[auth] The token endpoint answered ${response.status}.`);
      return null;
    }
    const json = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
    if (typeof json?.id_token !== "string" || json.id_token.length === 0) {
      console.warn("[auth] The token endpoint sent no id_token.");
      return null;
    }
    return json.id_token;
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    console.warn(timedOut ? "[auth] The token endpoint timed out." : "[auth] The token endpoint could not be reached.");
    return null;
  }
}

export type IdClaims = {
  sub: string;
  name?: string;
  nickname?: string;
  email?: string;
};

function decodeSegment(segment: string | undefined): Record<string, unknown> | null {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Checks the id_token's claims and returns the few we use, or null.
 *
 * The signature is deliberately not verified. This token came straight from Auth0's token
 * endpoint, over TLS, in reply to a request authenticated with our client secret and PKCE
 * verifier. OpenID Connect Core 1.0, section 3.1.3.7, rule 6, allows TLS server validation to
 * replace the signature check in exactly that case. The claims are still checked: issuer,
 * audience, authorized party, expiry, issue time, nonce and subject. Never use this for a
 * token that arrived any other way (from a browser, a header or a query string).
 */
export function validateIdToken(
  idToken: string,
  { config, nonce, now = Date.now() }: { config: AuthConfig; nonce: string; now?: number },
): IdClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]);
  if (!header || !claims) return null;
  // An unsigned token is never what Auth0 sends.
  if (typeof header.alg !== "string" || header.alg.toLowerCase() === "none") return null;

  const nowSeconds = Math.floor(now / 1000);
  if (claims.iss !== `https://${config.domain}/`) return null;

  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.some((value) => value === config.clientId)) return null;
  // With several audiences, azp must name us. When present, it must name us anyway.
  if (audiences.length > 1 && claims.azp === undefined) return null;
  if (claims.azp !== undefined && claims.azp !== config.clientId) return null;

  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) return null;
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) return null;

  if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, nonce)) return null;

  const sub = claims.sub;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > MAX_SUB_LENGTH) return null;

  return {
    sub,
    name: optionalString(claims.name),
    nickname: optionalString(claims.nickname),
    email: optionalString(claims.email),
  };
}
