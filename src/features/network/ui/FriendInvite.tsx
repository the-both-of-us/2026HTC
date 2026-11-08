"use client";

import { Check, Copy, RefreshCw, Share2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { forwardRef, useId, useImperativeHandle, useRef, useState } from "react";
import { Button, ErrorNotice, Spinner } from "@/shared/ui";
import { createInvite } from "./api";

export type FriendInviteHandle = { open: () => void };

type State = { status: "loading" } | { status: "ready"; url: string } | { status: "failed"; message: string };

/**
 * "Invite a friend": a personal link and QR code, the same approach as a study circle's
 * invite. The link works for any number of friends until "Make a new link" retires it.
 */
export const FriendInviteDialog = forwardRef<FriendInviteHandle, object>(function FriendInviteDialog(_props, ref) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, setState] = useState<State>({ status: "loading" });
  const [copied, setCopied] = useState(false);
  const [renewed, setRenewed] = useState(false);

  async function load(fresh: boolean) {
    setState({ status: "loading" });
    const result = await createInvite(fresh);
    if (result.ok) {
      setState({
        status: "ready",
        url: `${window.location.origin}/people/invite/${result.code}`,
      });
      setRenewed(fresh);
    } else setState({ status: "failed", message: result.message });
  }

  useImperativeHandle(ref, () => ({
    open: () => {
      dialogRef.current?.showModal();
      setRenewed(false);
      void load(false);
    },
  }));

  async function copy(url: string) {
    // Only say "copied" when it was: some browsers block the clipboard.
    const ok = await navigator.clipboard?.writeText(url).then(
      () => true,
      () => false,
    );
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share(url: string) {
    const data = {
      title: "Be my friend on OryxLearn",
      text: "Add me as a friend on OryxLearn to see the skills we've proved.",
      url,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
      }
    }
    await copy(url);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto max-h-[96dvh] w-[min(30rem,calc(100vw-1.5rem))] overflow-y-auto rounded-sheet border border-control-edge bg-sheet p-5 text-ink backdrop:bg-black/70 sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="text-2xl font-medium">
            Invite a friend
          </h2>
          <p className="mt-1 text-ink-soft">
            Anyone who opens this link can add you as a friend. Friends see each other&apos;s proven skills, whatever
            their network setting.
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

      <div className="mt-5">
        {state.status === "loading" && (
          <p role="status" className="flex items-center gap-3 text-ink-soft">
            <Spinner size={18} /> Making your link.
          </p>
        )}
        {state.status === "failed" && <ErrorNotice message={state.message} onRetry={() => load(false)} />}
        {state.status === "ready" && (
          <div className="flex flex-col items-center gap-3">
            <div className="mx-auto w-[min(100%,50dvh,18rem)] rounded-control border border-rule-strong bg-qr-paper p-[4%]">
              <QRCodeSVG
                style={{ display: "block", width: "100%", height: "auto" }}
                value={state.url}
                size={288}
                level="M"
                bgColor="#f7f9f5"
                fgColor="#0a3a37"
                marginSize={0}
                title="QR code that opens your friend invite"
              />
            </div>
            <p className="max-w-full font-mono text-sm break-all text-ink-soft select-all">{state.url}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => copy(state.url)}>
                {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
                {copied ? "Link copied" : "Copy link"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => share(state.url)}>
                <Share2 aria-hidden="true" size={16} />
                Share
              </Button>
              <Button variant="quiet" size="sm" onClick={() => load(true)}>
                <RefreshCw aria-hidden="true" size={16} />
                Make a new link
              </Button>
            </div>
            <p role="status" className="text-center text-sm text-ink-soft">
              {renewed
                ? "New link made. The old one no longer works."
                : "Making a new link stops the old one working. Friends you already have stay."}
            </p>
          </div>
        )}
      </div>
    </dialog>
  );
});
