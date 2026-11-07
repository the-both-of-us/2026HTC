"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

type Status = "failed" | "expired" | "unavailable";

/** Fixed sentences. Nothing from Auth0 or the URL is ever shown. */
export const SIGN_IN_MESSAGES: Record<Status, string> = {
  failed: "Sign-in didn't finish. You can try again.",
  expired: "Sign-in took too long or was started in another tab. Please try again.",
  unavailable: "Sign-in isn't available right now. You can keep learning as a guest.",
};

export function signInStatusFrom(search: string): Status | null {
  const value = new URLSearchParams(search).get("signin");
  return value === "failed" || value === "expired" || value === "unavailable" ? value : null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/**
 * Shows why sign-in didn't finish, from `?signin=failed|expired|unavailable`, with a
 * dismiss button. Reads the URL in the browser only, so pages can still be prerendered and
 * no Suspense boundary is needed.
 */
export function SignInNotice() {
  // Re-read the query string whenever the app navigates.
  usePathname();
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  const status = signInStatusFrom(search);
  if (!status || dismissed === search) return null;

  function dismiss() {
    setDismissed(search);
    // Drop the parameter, so a reload or a shared link doesn't show it again.
    const url = new URL(window.location.href);
    url.searchParams.delete("signin");
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <div
      role="status"
      className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-control border-2 border-control-edge bg-sheet p-3 text-base sm:mx-6"
    >
      <p>{SIGN_IN_MESSAGES[status]}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-m-1 inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-control text-ink-soft hover:bg-raised hover:text-ink"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
