"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";
import { Button, buttonClasses } from "./Button";

/**
 * The account line in the shell, in Seal's style. Sign-in is the auth feature's (Mirza's):
 * shared code can't import a feature, so this asks its public GET /api/auth/session, the same
 * call his AccountStatusLoader makes, and the shape is repeated here.
 */
type Account = { available: boolean; signedIn: boolean; displayName: string | null };

let request: Promise<Account | null> | null = null;

/** One request per page load, shared by the top bar and the menu. Signing in or out reloads the page. */
function loadAccount(): Promise<Account | null> {
  request ??= fetch("/api/auth/session", { signal: AbortSignal.timeout(10_000) })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: Partial<Account> | null) =>
      typeof body?.available === "boolean" && typeof body.signedIn === "boolean"
        ? { available: body.available, signedIn: body.signedIn, displayName: body.displayName ?? null }
        : null,
    )
    .catch(() => null);
  return request;
}

/** Null while loading, if the request fails, or when sign-in isn't set up on this host. */
export function useAccount(): Account | null {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    let live = true;
    loadAccount().then((value) => live && setAccount(value?.available ? value : null));
    return () => {
      live = false;
    };
  }, []);
  return account;
}

/** /sign-in, remembering this page so sign-in comes back to it. */
export function signInHref(pathname: string | null): string {
  const back = pathname && pathname.startsWith("/") && !pathname.startsWith("/sign-in") ? pathname : "/";
  return `/sign-in?${new URLSearchParams({ returnTo: back })}`;
}

/** Sidebar footer and phone menu: "Sign in" for guests, the name and "Sign out" when signed in. */
export function AccountStatusLine() {
  const account = useAccount();
  const pathname = usePathname();

  if (account?.signedIn) {
    return (
      <div className="flex flex-col items-start gap-1 text-sm">
        <p className="break-words text-ink-soft">
          Signed in as <span className="font-semibold text-ink">{account.displayName || "Learner"}</span>
        </p>
        {/* A real form post: the auth feature only signs out on a same-site POST. */}
        <form method="post" action="/api/auth/logout">
          <Button type="submit" variant="quiet" size="sm" className="-ml-3">
            Sign out
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {account && (
        <Link href={signInHref(pathname)} className={clsx(buttonClasses("primary", "md"), "w-full gap-2")}>
          <LogIn size={18} aria-hidden="true" />
          Sign in
        </Link>
      )}
      <p className="text-sm text-ink-soft">
        {account
          ? "Learning as a guest. Sign in to keep your progress on every device. "
          : "Learning as a guest. Your progress stays in this browser. "}
        <Link href="/trust" className="font-semibold text-ink underline underline-offset-4">
          What we store
        </Link>
      </p>
    </div>
  );
}

/** The phone top bar: a short "Sign in" link for guests. Signed-in people find their name in the menu. */
export function TopBarSignIn({ className }: { className?: string }) {
  const account = useAccount();
  const pathname = usePathname();
  if (!account || account.signedIn) return null;
  return (
    <Link href={signInHref(pathname)} className={clsx(buttonClasses("secondary", "sm"), "gap-1.5", className)}>
      <LogIn size={16} aria-hidden="true" />
      Sign in
    </Link>
  );
}
