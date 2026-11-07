"use client";

import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Button } from "@/shared/ui";

/** The QR code and link for this page. A QR code is no use on the phone that just scanned it. */
export function ShareProof({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // The browser refused. The link is still on screen to select by hand.
      setCopyFailed(true);
    }
  }

  return (
    <section
      aria-label="Share this page"
      className="flex flex-col gap-3 rounded-sheet border border-rule-strong bg-sheet/90 p-4 sm:w-52 sm:shrink-0"
    >
      <div className="hidden rounded-control bg-white p-3 sm:block">
        <QRCodeSVG
          value={url}
          size={160}
          level="M"
          marginSize={0}
          bgColor="#ffffff"
          fgColor="#070a10"
          title="QR code for this evidence page"
          className="h-auto w-full"
        />
      </div>
      <p className="hidden text-sm text-ink-soft sm:block">Scan to check this on your phone.</p>
      <Button variant="subtle" onClick={copyLink}>
        {copied ? <Check aria-hidden="true" size={17} /> : <Copy aria-hidden="true" size={17} />}
        {copied ? "Link copied" : "Copy link"}
      </Button>
      {copyFailed && <p className="text-sm break-all text-ink-soft">{url}</p>}
    </section>
  );
}
