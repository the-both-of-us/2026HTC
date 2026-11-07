"use client";

import { Check, Link2, Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/ui";
import "./proof.css";

/** Copy link and print, for whoever is reading. Neither appears on paper. */
export function DocumentActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div className="flex flex-wrap gap-2">
        <Button variant="subtle" size="sm" onClick={copyLink}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
          {copied ? "Link copied" : "Copy link"}
        </Button>
        <Button variant="subtle" size="sm" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" />
          Print one page
        </Button>
      </div>
      <p aria-live="polite" className="text-sm text-ink-soft">
        {copyFailed ? `Your browser blocked copying. The link is ${url}` : ""}
      </p>
    </div>
  );
}
