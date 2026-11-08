"use client";

import { useSearchParams } from "next/navigation";
import { buttonClasses } from "@/shared/ui";

/** The Auth0 login link, coming back to ?returnTo. The auth feature checks the path again on its side. */
function loginHref(returnTo: string | null): string {
  const path = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/api/auth/login?${new URLSearchParams({ returnTo: path })}`;
}

/** A plain link, not next/link: it leaves the app for Auth0. */
export function ContinueButton() {
  const returnTo = useSearchParams().get("returnTo");
  return <ContinueLink href={loginHref(returnTo)} />;
}

export function ContinueLink({ href }: { href: string }) {
  return (
    <a href={href} className={buttonClasses("primary", "md")}>
      Continue with Auth0
    </a>
  );
}
