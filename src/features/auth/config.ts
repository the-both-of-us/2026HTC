/**
 * Auth0 settings from the environment. Sign-in is optional: with any required value
 * missing or malformed, the app keeps working for guests and sign-in says it is unavailable.
 *
 * Values are never logged. A problem is reported by variable name only.
 */

export type AuthConfig = {
  /** The bare Auth0 host, such as `dev-xyz.us.auth0.com`. */
  domain: string;
  clientId: string;
  clientSecret: string;
  /** Signs the short-lived sign-in cookie. At least 32 characters. */
  secret: string;
  /** The site's origin, with no trailing slash, such as `http://localhost:3000`. */
  baseUrl: string;
};

const MIN_SECRET_LENGTH = 32;
// A hostname: labels of letters, digits and hyphens, with an optional port. No scheme, path or slash.
const HOST_PATTERN = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/i;

/** Logged once per problem, by name, so a misconfigured server says why sign-in is off. */
const reported = new Set<string>();
function report(problem: string): void {
  if (reported.has(problem)) return;
  reported.add(problem);
  console.warn(`[auth] Sign-in is off: ${problem}`);
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** The origin of an http(s) URL, or null. Accepts a trailing slash, rejects anything with a path. */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function findProblem(domain: string, clientId: string, clientSecret: string, secret: string): string | null {
  if (!domain) return "AUTH0_DOMAIN is not set.";
  if (!HOST_PATTERN.test(domain)) return "AUTH0_DOMAIN must be a bare host, with no https:// and no slash.";
  if (!clientId) return "AUTH0_CLIENT_ID is not set.";
  if (!clientSecret) return "AUTH0_CLIENT_SECRET is not set.";
  if (secret.length < MIN_SECRET_LENGTH) {
    return `AUTH0_SECRET must be at least ${MIN_SECRET_LENGTH} characters (openssl rand -hex 32).`;
  }
  return null;
}

/** The values that don't depend on the request, or null when sign-in is not set up. */
function staticConfig(): Omit<AuthConfig, "baseUrl"> | null {
  const domain = env("AUTH0_DOMAIN");
  const clientId = env("AUTH0_CLIENT_ID");
  const clientSecret = env("AUTH0_CLIENT_SECRET");
  const secret = env("AUTH0_SECRET");

  // Nothing set at all is the normal "no sign-in" setup, not a problem worth logging.
  if (!domain && !clientId && !clientSecret && !secret) return null;

  const problem = findProblem(domain, clientId, clientSecret, secret);
  if (problem) {
    report(problem);
    return null;
  }
  return { domain: domain.toLowerCase(), clientId, clientSecret, secret };
}

/** APP_BASE_URL when it is set and valid, otherwise the origin the request came in on. */
export function siteOrigin(request?: Request): string | null {
  const configured = env("APP_BASE_URL");
  if (configured) {
    const origin = originOf(configured);
    if (origin) return origin;
    report("APP_BASE_URL must be an http(s) origin such as https://oryxlearn.vercel.app, with no path.");
    return null;
  }
  return request ? originOf(new URL(request.url).origin) : null;
}

/**
 * Everything sign-in needs, or null when it is not set up. Without APP_BASE_URL the base
 * comes from the request; Auth0 only redirects to callback URLs listed in the dashboard,
 * so a forged Host header can't send a code elsewhere.
 */
export function authConfig(request?: Request): AuthConfig | null {
  const config = staticConfig();
  if (!config) return null;
  const baseUrl = siteOrigin(request);
  if (!baseUrl) return null;
  return { ...config, baseUrl };
}

/** True when the four Auth0 values are set and well formed. Then publishing and liking need a sign-in. */
export function isAuthConfigured(): boolean {
  if (!staticConfig()) return false;
  // A set but malformed APP_BASE_URL turns sign-in off rather than guessing.
  return !env("APP_BASE_URL") || siteOrigin() !== null;
}
