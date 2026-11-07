"use client";

import { usePathname } from "next/navigation";
import { Button, buttonClasses } from "@/shared/ui";
import { loginHref, LOGOUT_ACTION } from "./links";

export type AccountStatusProps = {
  signedIn: boolean;
  displayName: string | null;
  /** Where to come back to after signing in. Defaults to the current page. */
  returnTo?: string;
};

/**
 * "Sign in", or "Signed in as <name>" with "Sign out". Presentational: the server passes
 * signedIn and displayName, never a user id. Small enough for the sidebar footer and the
 * phone top bar.
 */
export function AccountStatus({ signedIn, displayName, returnTo }: AccountStatusProps) {
  const pathname = usePathname();
  const back = returnTo ?? pathname ?? "/";

  if (signedIn) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="break-words text-ink-soft">
          Signed in as <span className="font-semibold text-ink">{displayName || "Learner"}</span>
        </p>
        {/* A real form post, so it works without JavaScript and can't be triggered by a link preview. */}
        <form method="post" action={LOGOUT_ACTION}>
          <Button type="submit" variant="quiet" size="sm" className="-ml-3">
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      {/* A plain link, not next/link: it leaves the app for Auth0. */}
      <a href={loginHref(back)} className={buttonClasses("secondary", "sm")}>
        Sign in
      </a>
      <p className="text-ink-soft">Sign in to keep your courses on any device.</p>
    </div>
  );
}
