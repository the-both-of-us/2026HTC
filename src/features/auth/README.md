# auth

Optional sign-in with Auth0. **Never a login wall:** guests can build maps, prove skills, use flashcards and quizzes, and start courses. Only **joining the network** (a profile on People) needs a sign-in, and only when Auth0 is set up. Signing in links the visitor's current guest id to their Auth0 account, so the same id, and every map, proof and course under it, follows them to any device. No data is copied or moved.

Written by hand against OpenID Connect (Authorization Code flow with PKCE), with `fetch` and `node:crypto`. No Auth0 SDK and no JWT library: the SDK hooks in through middleware, and Next 16 changed middleware (now "proxy"), so three small route handlers were simpler and easier to explain.

## The flow, in words

1. **Sign in** link → `GET /api/auth/login?returnTo=/people`.
   - The server makes three random values (32 bytes each, base64url): `state`, `nonce` and the PKCE `code_verifier`.
   - It saves them, with `returnTo` and the time, in the `pf_auth_tx` cookie: httpOnly, SameSite=Lax, Secure in production, path `/api/auth`, 10 minutes, HMAC-SHA256 signed with `AUTH0_SECRET`.
   - It redirects (302) to `https://<AUTH0_DOMAIN>/authorize` with `response_type=code`, `client_id`, `redirect_uri=<base>/api/auth/callback`, `scope=openid profile email`, `state`, `nonce`, `code_challenge=base64url(sha256(verifier))` and `code_challenge_method=S256`. No secret is in that URL.
   - `?connection=google-oauth2` or `?connection=Username-Password-Authentication` skips Auth0's chooser. Any other value is ignored.
2. The person signs in at Auth0 (email and password, or Google), and Auth0 sends them to `GET /api/auth/callback?code=…&state=…`.
3. **Callback:**
   - It reads and deletes `pf_auth_tx` (single use, whatever happens), checks its signature and age, and compares `state` in constant time.
   - It POSTs the code and verifier, with the client id and secret, to `https://<AUTH0_DOMAIN>/oauth/token` (form-encoded, 10 second timeout).
   - It checks the returned `id_token`'s claims (see below), links the account, and calls `setSessionUser(userId, { displayName })`. Then it redirects (303) back to `returnTo`.
4. **Sign out**: the "Sign out" form POSTs to `/api/auth/logout`, which calls `clearSession()` and so gives a fresh guest id. Judges share one laptop, so the next person must not see the last person's private courses. Then it redirects (303) to `https://<AUTH0_DOMAIN>/v2/logout?client_id=…&returnTo=<base>`, so Auth0 forgets the session too. The destination is built from config only, so it is never an open redirect.
   - **Only a same-origin POST from someone signed in does anything.** A `GET`, a POST whose `Sec-Fetch-Site` is not `same-origin` (or, from a browser without that header, whose `Origin` is not this site), and a guest's POST all just redirect to `/` with every cookie untouched. Otherwise any site could send a visitor to the logout URL (a link, a redirect, a self-submitting form), and for a guest that would swap their id for good, orphaning every map, proof and course they made. A request with neither header comes from no browser, so it is allowed.

**When something goes wrong** the visitor lands back on the site with `?signin=…`, and `SignInNotice` shows one fixed sentence. Nothing Auth0 sent (error text, codes, tokens) is ever echoed into a page, a header or the log.

| Case | Redirect |
|---|---|
| Auth0 sent `?error=` (cancelled, refused) | `returnTo?signin=failed` |
| `pf_auth_tx` missing, tampered, expired, or `state` differs | `/?signin=expired` |
| Token endpoint non-200, timeout, unreachable, or bad `id_token` | `returnTo?signin=failed` |
| Auth0 not set up | `/?signin=unavailable` |

## Why the id_token's signature is not checked

The `id_token` comes **straight from Auth0's token endpoint**, over TLS, in reply to a request authenticated with our client secret and PKCE verifier. OpenID Connect Core 1.0, [section 3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), rule 6, says that in this case TLS server validation may be used instead of checking the token's signature. That is why no JWT library is needed.

The claims are still checked: `iss` is `https://<AUTH0_DOMAIN>/`, `aud` is (or contains) our client id, `azp` (when present, and required with several audiences) is our client id, `exp` is in the future and `iat` is not, with 60 seconds of clock skew, `nonce` matches the one we saved, `sub` is present, and `alg` is not `none`. **Never** use `validateIdToken` for a token that arrived any other way (from a browser, a header or a query string).

## Safe return paths

`returnTo` must be a same-site path: it starts with `/`, but not `//` or `/\`, has no scheme, no control characters (CR, LF, tab, NUL), no backslash, and is at most 512 characters. Anything else becomes `/`. It is checked when sign-in starts and again on the way out. What comes back is the URL's own percent-encoded form (`/courses/中` becomes `/courses/%E4%B8%AD`), so it is always ASCII and always a valid `Location` header; that form is checked again for `//` and for length.

## Account linking (`accounts.ts`)

| Key | Holds |
|---|---|
| `accounts/<sha256(sub) hex>` | `{userId, sub, createdAt}`: which OryxLearn id this Auth0 account uses |
| `account-of/<userId>` | `{subHash}`: the way back, for delete-my-data |

The raw `sub` is never in a key. Tokens and email addresses are stored nowhere. The display name lives only in identity's signed `pf_account` cookie.

On each sign-in, with `current = await getUserId()`:

1. If `accounts/<hash>` exists, use its `userId` (and rewrite `account-of/<userId>`, which repairs it). This is how the same id follows the person to another device.
2. Otherwise **reserve an id** with `claimDoc("account-of/<current>", {subHash})`, an atomic create-if-absent. If the claim fails and the doc already names this account (an earlier attempt that failed halfway), keep `current`. If it names a **different** account, this browser's id belongs to someone else, so claim `account-of/<randomUUID()>` instead. Account B never sees account A's courses. Because the way back is claimed first, "one id, one account" holds even when two accounts sign in at once with the same id, or when a write fails halfway.
3. `claimDoc("accounts/<hash>", …)`. If it loses a race (two first sign-ins to one account at once), read the winner's doc and use its id, and delete the `account-of` claim made in step 2, so a guest's own id stays free.
4. `setSessionUser(userId, { displayName })`.

**Display name:** `name`, then `nickname`, then the email's local part, then "Learner". Anything with an `@` keeps only the part before it, so an email address is never shown (Auth0 sets `name` to the email for password sign-ups). Control and format characters are stripped, whitespace is collapsed, and it is cut to 40 characters.

**Known gaps:**

- Guest progress made on a second device before signing in stays under that device's old guest id. Signing in there switches to the account's id.
- **Shared laptops (session fixation).** A first sign-in keeps the browser's guest id, and identity never rotates it. Someone who used the laptop as a guest earlier and copied their `pf_uid` from DevTools keeps owner access to that id after the next person signs in for the first time with it, on their own machine, without signing in: map ownership only checks `pf_uid`, and the signed value has no expiry or revocation. It can't be done remotely (state is bound to `pf_auth_tx`, and `vercel.app` is on the Public Suffix List). The fix belongs in `src/shared/identity.ts` (Abdu's): once `account-of/<id>` exists, accept `pf_uid` only together with a matching signed `pf_account`, or give `pf_uid` an issued-at and refuse a pre-link one. Until then, on a shared laptop, sign out before handing it over, or sign in before doing anything as a guest.

**`forgetAccount(userId)`**, exported for delete-my-data, deletes `account-of/<userId>` and the `accounts/<hash>` it points to (only if that still names this user). Signing in again afterwards links the account afresh, to whatever id the browser has then.

## Environment (names only)

| Variable | Required? | Notes |
|---|---|---|
| `AUTH0_DOMAIN` | For sign-in | Bare host, such as `dev-xyz.us.auth0.com`. No `https://`, no slash. |
| `AUTH0_CLIENT_ID` | For sign-in | |
| `AUTH0_CLIENT_SECRET` | For sign-in | Only ever sent to the token endpoint, in a POST body. |
| `AUTH0_SECRET` | For sign-in | At least 32 characters: `openssl rand -hex 32`. Signs `pf_auth_tx`. |
| `APP_BASE_URL` | Recommended | Origin only, such as `https://oryxlearn.vercel.app`. Without it the base comes from the request. |
| `SESSION_SECRET` | In production | Identity's own secret, which signs `pf_uid` and `pf_account`. |

With none of the four Auth0 values set, sign-in is simply off: `isAuthConfigured()` is false, guests may join the network, `AccountStatusServer` and `AccountStatusLoader` render nothing, and `/api/auth/login` redirects to `/?signin=unavailable`. Nothing throws. A value that is set but malformed also turns sign-in off, and the server logs which variable is wrong, by name only, never its value.

**Auth0 dashboard:** the application is a Regular Web Application, with Token Endpoint Authentication Method "Post". Allowed Callback URLs must include `<base>/api/auth/callback` and Allowed Logout URLs must include `<base>`, for every host (localhost, Vercel).

## API

| Route | Does |
|---|---|
| `GET /api/auth/login?returnTo=&connection=` | 302 to Auth0, or 303 to `/?signin=unavailable` |
| `GET /api/auth/callback` | 303 to `returnTo`, or a `?signin=` failure |
| `POST /api/auth/logout` | Same-origin and signed in: 303 to Auth0's logout, then back to the base URL. Otherwise (and for any `GET`): 303 to `/`, no cookie changed |
| `GET /api/auth/session` | `{available, signedIn, displayName}`, `Cache-Control: no-store`. Never the user id. |

## Exports

From `@/features/auth` (server only):

- `isAuthConfigured(): boolean`
- `forgetAccount(userId): Promise<void>`
- `handleLogin`, `handleCallback`, `handleLogout`, `handleSession`, `sessionSummary`
- `AccountStatusServer({ returnTo? })`: an async server component. It reads cookies, so wrap it in `<Suspense>`.

From `@/features/auth/client`:

- `AccountStatus({ signedIn, displayName, returnTo? })`: "Sign in" plus "Sign in to keep your courses on any device.", or "Signed in as <name>" plus a "Sign out" form post. Presentational: give it only `signedIn` and `displayName`, never a user id. `returnTo` defaults to the current path.
- `AccountStatusLoader()`: the same, for places rendered on the client, where a server component can't go. It asks `GET /api/auth/session`.
- `SignInNotice()`: the dismissible `role="status"` sentence for `?signin=failed|expired|unavailable`. It reads the URL in the browser only, so it needs no Suspense.

## For Abdu

These are in your files, so they are yours to place:

1. **Account status where PageShell says "Learning as a guest. Your progress stays with this browser."** (the sidebar footer, and the phone top bar). Most screens render `PageShell` from client components (for example `MapScreen`), where a server component can't go, so use the client loader there:

   ```tsx
   import { AccountStatusLoader } from "@/features/auth/client";
   // In PageShell's sidebar footer, in place of (or under) the guest line:
   <div className="mt-auto hidden border-t border-rule px-4 py-4 lg:block">
     <AccountStatusLoader />
   </div>
   ```

   In a server component such as `layout.tsx`, use the server version instead, inside Suspense:

   ```tsx
   import { Suspense } from "react";
   import { AccountStatusServer } from "@/features/auth";
   <Suspense fallback={null}><AccountStatusServer /></Suspense>
   ```

   Both render nothing when Auth0 is not set up, so the guest line can stay as the fallback.
2. **`<SignInNotice />` in `src/app/layout.tsx`**, just inside `<body>` before `{children}`: `import { SignInNotice } from "@/features/auth/client";`. No Suspense needed.
3. **Delete-my-data:** call `await forgetAccount(userId)` from `@/features/auth` along with the other deletes. The trust page can say: "Deleting your data also deletes the link between your sign-in and your OryxLearn id."
4. **Deploys:** set `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` and `APP_BASE_URL` (`https://oryxlearn.vercel.app` there) on every host, and add `https://<host>/api/auth/callback` and `https://<host>` to the Auth0 application's allowed callback and logout URLs. Add the five names, with empty values, to `.env.example`.

## Files

- `config.ts`: reads and checks the environment. `returnTo.ts`: the safe return path. `transaction.ts`: the signed `pf_auth_tx` cookie.
- `oidc.ts`: the authorize and logout URLs, PKCE, the token exchange, and the id_token claim checks.
- `accounts.ts`: account linking, `forgetAccount` and the display name. `handlers.ts`: the four routes.
- `ui/`: `AccountStatus`, `AccountStatusLoader`, `AccountStatusServer`, `SignInNotice`.

## Tests

`npm test -- auth` runs this feature's tests and `src/app/api/auth/routes.test.ts`. They use fake Auth0 values (`vi.stubEnv`) and a mocked `fetch`, so they never reach Auth0. A fake cookie jar per browser (`testing.ts`) lets them sign in from several "browsers" at once, including a race of first sign-ins to one account.
