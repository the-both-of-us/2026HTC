"use client";

import { BadgeCheck, Check, ExternalLink, Link2, Share2, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { Button, ErrorNotice, Field, Spinner, buttonClasses } from "@/shared/ui";
import type { OwnerProofView } from "../types";
import { loadOwnProof, publish, withdraw } from "./api";
import { plural } from "./format";
import { ProofQr } from "./ProofQr";

export type ShareProofButtonProps = {
  mapId: string;
  /** How many skills are proven on this map right now. Below 1, there is nothing to share. */
  provenCount: number;
};

/** Publishes the evidence page and hands over its link and QR code. */
export function ShareProofButton({ mapId, provenCount }: ShareProofButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [loading, setLoading] = useState(false);
  const [proof, setProof] = useState<OwnerProofView | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (provenCount < 1) {
    return (
      <Button variant="subtle" disabled>
        <Share2 size={18} aria-hidden="true" />
        Prove a skill to share evidence
      </Button>
    );
  }

  async function open() {
    dialogRef.current?.showModal();
    setError(null);
    setEditing(false);
    setLoading(true);
    try {
      const existing = await loadOwnProof(mapId);
      setProof(existing);
      if (existing?.displayName) setName(existing.displayName);
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setProof(await publish(mapId, name));
      setEditing(false);
      // The button that had focus is about to disappear, so move focus to the new heading.
      headingRef.current?.focus();
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setPending(false);
    }
  }

  async function takeDown() {
    if (!proof) return;
    setPending(true);
    setError(null);
    try {
      setProof(await withdraw(proof.id));
      headingRef.current?.focus();
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      setPending(false);
    }
  }

  const live = proof?.state === "live" ? proof : null;

  return (
    <>
      <Button variant="secondary" onClick={open}>
        <BadgeCheck size={17} aria-hidden="true" />
        Evidence page
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto max-h-[90dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-control-edge bg-sheet p-5 text-ink backdrop:bg-black/70 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 ref={headingRef} tabIndex={-1} id={titleId} className="text-2xl font-medium">
            {live && !editing ? "Your evidence page is live" : "Share your evidence"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="-m-1 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-paper"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          {error && <ErrorNotice message={error} />}

          {loading ? (
            <p role="status" className="flex items-center gap-3 text-ink-soft">
              <Spinner size={18} />
              Checking for an existing page
            </p>
          ) : live && !editing ? (
            <PublishedView
              proof={live}
              provenCount={provenCount}
              pending={pending}
              onEdit={() => setEditing(true)}
              onWithdraw={takeDown}
            />
          ) : (
            <NameForm
              name={name}
              provenCount={provenCount}
              wasWithdrawn={proof?.state === "revoked"}
              updating={Boolean(live)}
              pending={pending}
              onNameChange={setName}
              onSubmit={submit}
              onCancel={() => setEditing(false)}
            />
          )}
        </div>
      </dialog>
    </>
  );
}

function messageOf(problem: unknown): string {
  return problem instanceof Error ? problem.message : "Something went wrong. Please try again.";
}

type NameFormProps = {
  name: string;
  provenCount: number;
  wasWithdrawn: boolean;
  updating: boolean;
  pending: boolean;
  onNameChange: (name: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
};

function NameForm({ name, provenCount, wasWithdrawn, updating, pending, onNameChange, onSubmit, onCancel }: NameFormProps) {
  const fieldId = useId();

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {wasWithdrawn && <p className="text-ink-soft">You withdrew your last page. Publishing again brings it back at the same link.</p>}
      <p>
        This creates a public page for {plural(provenCount, "proven skill")}. Anyone with the link can read your name and
        what you wrote for those skills. You can withdraw it at any time.
      </p>
      <Field id={fieldId} label="Name to show" hint="Employers will see this exactly as you type it.">
        {(control) => (
          <input
            {...control}
            required
            maxLength={60}
            autoComplete="name"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            className="block min-h-11 w-full rounded-control border-2 border-control-edge bg-paper px-3.5 py-2 text-base text-ink aria-invalid:border-danger"
          />
        )}
      </Field>
      <Button type="submit" pending={pending}>
        {updating ? "Update my page" : "Publish my page"}
      </Button>
      {updating && (
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Back
        </Button>
      )}
    </form>
  );
}

type PublishedViewProps = {
  proof: OwnerProofView;
  provenCount: number;
  pending: boolean;
  onEdit: () => void;
  onWithdraw: () => void;
};

function PublishedView({ proof, provenCount, pending, onEdit, onWithdraw }: PublishedViewProps) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  // This view only exists after a click, so it never renders on the server.
  const url = new URL(proof.path, window.location.origin).href;
  const onlyThisComputer = window.location.hostname === "localhost";
  const behind = provenCount > (proof.provenCount ?? 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: select the link instead, ready for the person to copy by hand.
      linkRef.current?.select();
    }
  }

  return (
    <>
      <p className="text-ink-soft">
        {proof.displayName} · {proof.provenCount} of {proof.totalSkills} skills proven
      </p>

      <div className="flex justify-center">
        <ProofQr url={url} size={176} />
      </div>
      {onlyThisComputer && (
        <p className="text-sm text-ink-soft">
          You are on localhost, so this link and QR code only work on this computer.
        </p>
      )}

      <div className="flex gap-2">
        <input
          ref={linkRef}
          readOnly
          aria-label="Link to your evidence page"
          value={url}
          onFocus={(event) => event.target.select()}
          className="block min-h-11 min-w-0 flex-1 rounded-control border-2 border-control-edge bg-paper px-3 py-2 text-sm text-ink"
        />
        <Button variant="secondary" onClick={copy} aria-label={copied ? "Link copied" : "Copy link"}>
          {copied ? <Check size={18} aria-hidden="true" /> : <Link2 size={18} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <a href={proof.path} target="_blank" rel="noreferrer" className={buttonClasses("primary")}>
        Open the page
        <ExternalLink size={18} aria-hidden="true" />
      </a>

      {behind && (
        <div className="rounded-control border border-control-edge p-3">
          <p>
            You have proven {plural(provenCount, "skill")} now, but this page shows {proof.provenCount}.
          </p>
          <Button variant="subtle" size="sm" onClick={onEdit} className="mt-2">
            Add them to the page
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3">
        {!behind && (
          <Button variant="quiet" size="sm" onClick={onEdit}>
            Change name or update
          </Button>
        )}
        {confirming ? (
          <div className="flex w-full flex-col gap-2">
            <p>
              Withdraw this page? The public copy is removed, and anyone with the link will see that it was withdrawn. Your
              attempts stay on your map, so you can publish again.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="subtle" size="sm" pending={pending} onClick={onWithdraw}>
                Yes, withdraw it
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
                Keep it live
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="quiet" size="sm" onClick={() => setConfirming(true)}>
            Withdraw this page
          </Button>
        )}
      </div>
    </>
  );
}
