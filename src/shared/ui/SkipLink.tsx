"use client";

import type { MouseEvent } from "react";

/**
 * Jumps to this page's <main>. Next.js keeps visited pages in the document, hidden,
 * so a plain href="#main" can land on a hidden page. This looks inside its own shell.
 */
export function SkipLink() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    const main = event.currentTarget.parentElement?.querySelector("main");
    if (!main) return;
    event.preventDefault();
    main.focus();
  }

  return (
    <a
      href="#main"
      onClick={skip}
      className="sr-only bg-ink font-semibold text-on-ink focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
    >
      Skip to main content
    </a>
  );
}
