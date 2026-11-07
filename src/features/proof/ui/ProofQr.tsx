"use client";

import { QRCodeSVG } from "qrcode.react";

type ProofQrProps = { url: string; size?: number };

/** Dark on white with a quiet border, whatever the page theme: that is what scanners read best. */
export function ProofQr({ url, size = 128 }: ProofQrProps) {
  return (
    <div className="inline-block rounded-control bg-white p-2.5" role="img" aria-label="QR code that opens this evidence page">
      <QRCodeSVG value={url} size={size} level="M" bgColor="#ffffff" fgColor="#070a10" marginSize={0} />
    </div>
  );
}
