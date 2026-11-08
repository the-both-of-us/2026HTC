"use client";

import { Check, Share2, X } from "lucide-react";
import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/shared/ui";
import { CircleQr } from "./CircleQr";

/** What a share sheet or a pasted message says around the link. */
function invite(title: string, url: string) {
  return {
    title: `Study circle: ${title}`,
    text: `Learn ${title} with me on OryxLearn. You get your own copy of the map, and we see each other's progress.`,
    url,
  };
}

type ShareResult = "shared" | "copied" | "failed" | "cancelled";

/** The phone's share sheet when there is one, otherwise the clipboard. */
async function shareInvite(title: string, url: string): Promise<ShareResult> {
  const data = invite(title, url);
  if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error) {
      // Closing the share sheet is a choice, not a failure.
      if ((error as Error).name === "AbortError") return "cancelled";
    }
  }
  const copied = await navigator.clipboard?.writeText(url).then(
    () => true,
    () => false,
  );
  return copied ? "copied" : "failed";
}

/**
 * "Share invite": the native share sheet on a phone, or a copied link. It says what really
 * happened, and when nothing worked it shows the link so it can be copied by hand.
 */
export function ShareInviteButton({
  title,
  url,
  variant = "secondary",
  size = "md",
  className,
}: {
  title: string;
  url: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  className?: string;
}) {
  const [result, setResult] = useState<ShareResult | null>(null);

  async function share() {
    const outcome = await shareInvite(title, url);
    setResult(outcome === "cancelled" ? null : outcome);
    if (outcome === "copied" || outcome === "shared") setTimeout(() => setResult(null), 2500);
  }

  return (
    <div className={className}>
      <Button variant={variant} size={size} onClick={share} className="w-full">
        {result === "copied" ? <Check aria-hidden="true" size={17} /> : <Share2 aria-hidden="true" size={17} />}
        {result === "copied" ? "Link copied" : "Share invite"}
      </Button>
      <p role="status" className="mt-1.5 text-sm text-ink-soft empty:hidden">
        {result === "copied" && "Paste it anywhere: a group chat, an email, a class forum."}
        {result === "failed" && (
          <>
            Sharing is blocked in this browser. Copy the link instead:{" "}
            <span className="font-mono break-all text-ink select-all">{url}</span>
          </>
        )}
      </p>
    </div>
  );
}

export type InviteDialogHandle = { open: () => void };

/** The invite, big enough to scan from the back of a room: a QR code, the link and a share button. */
export const InviteDialog = forwardRef<InviteDialogHandle, { title: string; url: string }>(function InviteDialog(
  { title, url },
  ref,
) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useImperativeHandle(ref, () => ({ open: () => dialogRef.current?.showModal() }), []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Clicking the dimmed backdrop closes it, like Escape.
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto max-h-[96dvh] w-[min(44rem,calc(100vw-1.5rem))] overflow-y-auto rounded-sheet border border-control-edge bg-sheet p-5 text-ink backdrop:bg-black/70 sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="text-2xl font-medium sm:text-3xl">
            Scan to join
          </h2>
          <p className="mt-1 text-ink-soft sm:text-lg">
            Everyone who joins learns {title} on their own copy of the map.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
          className="-m-1 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-paper"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      {/* As big as the screen allows, so it scans from across a room. */}
      <div className="mx-auto mt-5 w-[min(100%,58dvh,26rem)]">
        <CircleQr url={url} size={416} fluid>
          <ShareInviteButton title={title} url={url} size="sm" />
        </CircleQr>
      </div>
    </dialog>
  );
});
