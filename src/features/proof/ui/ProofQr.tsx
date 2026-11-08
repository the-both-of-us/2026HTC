"use client";

import { QRCodeSVG } from "qrcode.react";

type ProofQrProps = { url: string; size?: number };

/** Dark on white with a quiet border, whatever the page theme: that is what scanners read best. */
export function ProofQr({ url, size = 128 }: ProofQrProps) {
  return (
    <div className="inline-block rounded-control bg-sheet border border-rule-strong p-2.5">
      <QRCodeSVG
        value={url}
        size={size}
        level="M"
        bgColor="#f7f9f5"
        fgColor="#0a3a37"
        marginSize={0}
        title="QR code that opens this evidence page"
      />
    </div>
  );
}
