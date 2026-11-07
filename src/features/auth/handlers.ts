/**
 * The three sign-in routes. The route files in src/app/api/auth only call these.
 *
 * Every answer is a redirect with no body. Nothing Auth0 sends back (error text, codes,
 * tokens) is ever echoed into a page, a header or the log.
 */
import { clearSession, getSession, setSessionUser } from "@/shared/identity";
import { displayNameFrom, linkAccount } from "./accounts";
import { authConfig, isAuthConfigured, siteOrigin } from "./config";
import { authorizeUrl, exchangeCode, logoutUrl, randomToken, validateIdToken } from "./oidc";
import { safeReturnTo, withSignInStatus } from "./returnTo";
import { safeEqual, saveTransaction, takeTransaction } from "./transaction";

/**
 * A redirect. A same-site path stays relative, so the browser resolves it against the host
 * it is really on, even behind a proxy. 303 makes the next request a GET, even after a POST.
 */
function redirect(location: string, status: 302 | 303 = 303): Response {
  return new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });
}

/** GET /api/auth/login?returnTo=/path&connection=google-oauth2 */
export async function handleLogin(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const returnTo = safeReturnTo(params.get("returnTo"));
  const config = authConfig(request);
  if (!config) return redirect(withSignInStatus("/", "unavailable"));

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  try {
    await saveTransaction({ state, nonce, verifier, returnTo, createdAt: Date.now() }, config.secret);
  } catch (error) {
    console.warn("[auth] Could not start sign-in:", error instanceof Error ? error.name : "unknown error");
    return redirect(withSignInStatus(returnTo, "failed"));
  }
  return redirect(authorizeUrl(config, { state, nonce, verifier, connection: params.get("connection") }), 302);
}

/** GET /api/auth/callback?code=&state= (or ?error= when the person cancelled or Auth0 refused). */
export async function handleCallback(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const config = authConfig(request);
  // Always read and delete the transaction, so it is single use whatever happens below.
  const tx = await takeTransaction(config?.secret ?? null);
  if (!config) return redirect(withSignInStatus("/", "unavailable"));

  if (params.has("error")) return redirect(withSignInStatus(tx?.returnTo ?? "/", "failed"));

  const state = params.get("state");
  if (!tx || !state || !safeEqual(state, tx.state)) return redirect(withSignInStatus("/", "expired"));

  const code = params.get("code");
  if (!code) return redirect(withSignInStatus(tx.returnTo, "failed"));

  const idToken = await exchangeCode(config, { code, verifier: tx.verifier });
  const claims = idToken ? validateIdToken(idToken, { config, nonce: tx.nonce }) : null;
  if (!claims) {
    if (idToken) console.warn("[auth] The id_token failed its checks.");
    return redirect(withSignInStatus(tx.returnTo, "failed"));
  }

  try {
    const userId = await linkAccount(claims.sub);
    await setSessionUser(userId, { displayName: displayNameFrom(claims) });
  } catch (error) {
    console.warn("[auth] Could not finish sign-in:", error instanceof Error ? error.name : "unknown error");
    return redirect(withSignInStatus(tx.returnTo, "failed"));
  }
  return redirect(safeReturnTo(tx.returnTo));
}

/**
 * Only a sign-out the site itself asked for counts. A link, redirect or self-submitting form
 * on another site must not be able to sign anyone out: for a guest that would swap their id,
 * and nothing could ever lead back to the work saved under the old one.
 *
 * Browsers send Sec-Fetch-Site; older ones send Origin on every POST. A request with neither
 * comes from no browser (curl, a test), so it can't be cross-site request forgery.
 */
function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return origin === new URL(request.url).origin || origin === siteOrigin(request);
}

/**
 * POST /api/auth/logout, from the "Sign out" form.
 *
 * Signs out here and starts a fresh guest, so the next person on a shared laptop can't see
 * the last person's private courses. Then signs out of Auth0 too, which returns to the home
 * page. The destination is built from config only, so this is never an open redirect.
 *
 * Anything else just goes home with every cookie untouched: a GET, a request from another
 * site, and a guest (who has nothing to sign out of, and must keep their id).
 */
export async function handleLogout(request: Request): Promise<Response> {
  if (request.method !== "POST" || !isSameOriginRequest(request)) return redirect("/");
  if (!(await getSession()).signedIn) return redirect("/");

  try {
    await clearSession();
  } catch (error) {
    console.warn("[auth] Could not clear the session:", error instanceof Error ? error.name : "unknown error");
  }
  const config = authConfig(request);
  return redirect(config ? logoutUrl(config) : "/");
}

export type SessionSummary = {
  /** False when Auth0 is not set up, so the UI shows no sign-in at all. */
  available: boolean;
  signedIn: boolean;
  displayName: string | null;
};

/** What the browser may know about the session: never the user id. */
export async function sessionSummary(): Promise<SessionSummary> {
  if (!isAuthConfigured()) return { available: false, signedIn: false, displayName: null };
  const session = await getSession();
  return { available: true, signedIn: session.signedIn, displayName: session.signedIn ? session.displayName : null };
}

/** GET /api/auth/session: `{available, signedIn, displayName}` for client-rendered pages. */
export async function handleSession(): Promise<Response> {
  return Response.json(await sessionSummary(), { headers: { "Cache-Control": "no-store" } });
}
