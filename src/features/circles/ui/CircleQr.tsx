"use client";

import { Check, Copy } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { Button } from "@/shared/ui";

/** A QR code big enough to scan from across a room, with the link to copy underneath. */
export function CircleQr({ url, size = 240 }: { url: string; size?: number }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    // Only say "copied" when it was: some browsers block the clipboard.
    const ok = await navigator.clipboard.writeText(url).then(() => true, () => false);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-control border border-rule-strong bg-qr-paper p-3">
        <QRCodeSVG
          value={url}
          size={size}
          level="M"
          bgColor="#f7f9f5"
          fgColor="#0a3a37"
          marginSize={0}
          title="QR code that opens this study circle"
        />
      </div>
      <p className="max-w-full font-mono text-sm break-all text-ink-soft">{url}</p>
      <Button variant="secondary" size="sm" onClick={copy}>
        {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        {copied ? "Link copied" : "Copy link"}
      </Button>
    </div>
  );
}
