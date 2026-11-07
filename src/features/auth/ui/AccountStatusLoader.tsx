"use client";

import { useEffect, useState } from "react";
import { AccountStatus } from "./AccountStatus";

type Summary = { available: boolean; signedIn: boolean; displayName: string | null };

function isSummary(value: unknown): value is Summary {
  const summary = value as Partial<Summary> | null;
  return typeof summary?.available === "boolean" && typeof summary.signedIn === "boolean";
}

/**
 * AccountStatus for places that render on the client, such as a PageShell inside a client
 * screen, where a server component can't go. It asks GET /api/auth/session, which returns
 * only `{available, signedIn, displayName}`. Shows nothing while loading, if sign-in is not
 * set up, or if the request fails.
 */
export function AccountStatusLoader() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let current = true;
    fetch("/api/auth/session", { signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (current && isSummary(body)) setSummary(body);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  if (!summary?.available) return null;
  return <AccountStatus signedIn={summary.signedIn} displayName={summary.displayName} />;
}
