/** The login link for a page. A plain URL, so it works without JavaScript. */
export function loginHref(returnTo: string | null | undefined): string {
  const path = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/api/auth/login?${new URLSearchParams({ returnTo: path })}`;
}

export const LOGOUT_ACTION = "/api/auth/logout";
