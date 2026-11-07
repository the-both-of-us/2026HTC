/**
 * Where to send someone after sign-in. Only a path on this site is allowed, so a crafted
 * login link can't bounce a visitor to another site (an open redirect).
 */

const MAX_LENGTH = 512;
const HOME = "/";

/**
 * Returns the value if it is a same-site relative path, otherwise "/".
 *
 * Refused: anything not starting with "/", protocol-relative "//host" and "/\host" (browsers
 * treat a backslash as a slash), any scheme, control characters such as CR/LF, and anything
 * over 512 characters. Checked on the way in and again on the way out. What comes back is
 * the percent-encoded form, so it is plain ASCII and safe in a Location header.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return HOME;
  if (value.length === 0 || value.length > MAX_LENGTH) return HOME;
  if (!value.startsWith("/")) return HOME;
  if (value.startsWith("//") || value.startsWith("/\\")) return HOME;
  // Control characters (CR, LF, tab, NUL and the rest) and backslashes anywhere.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return HOME;

  // Resolve against a placeholder origin: a path that stays on it is same-site.
  try {
    const base = "https://placeholder.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return HOME;
    // Return the URL's own serialisation, not the raw input: it is ASCII and percent-encoded,
    // so it is always a valid Location header (a raw "/中" would make the redirect throw).
    // Dot segments are resolved too, so check again for a path that now starts with "//".
    const normalised = `${url.pathname}${url.search}${url.hash}`;
    if (normalised.length > MAX_LENGTH || normalised.startsWith("//")) return HOME;
    return normalised;
  } catch {
    return HOME;
  }
}

/** The return path with `?signin=<status>` added, keeping its own query and hash. */
export function withSignInStatus(returnTo: string, status: "failed" | "expired" | "unavailable"): string {
  const base = "https://placeholder.invalid";
  const url = new URL(safeReturnTo(returnTo), base);
  url.searchParams.set("signin", status);
  return safeReturnTo(`${url.pathname}${url.search}${url.hash}`);
}
