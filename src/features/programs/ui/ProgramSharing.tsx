"use client";

import { Check, Copy, Globe, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { SignInPrompt } from "@/features/auth/client";
import { Button, buttonClasses, Field } from "@/shared/ui";
import type { ProgramSharing as Sharing, PublicProgram } from "../types";
import { programHref, shareProgram, unshareProgram } from "./sharingApi";

const INPUT_CLASSES =
  "block min-h-10 w-full rounded-control border-2 border-control-edge bg-sheet px-3 py-1.5 text-base text-ink placeholder:text-ink-soft";

type FocusTarget = "field" | "share" | "copy" | null;

/**
 * The owner's share panel on the program page: private with "Share program", or public with
 * a link to copy and "Make private". The same name and sign-in rules as publishing a course.
 */
export function ProgramSharing({ programId, sharing }: { programId: string; sharing: Sharing }) {
  const [listing, setListing] = useState<PublicProgram | null>(sharing.listing);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState(() => (sharing.listing?.authorName ?? sharing.displayName ?? "").slice(0, sharing.maxNameLength));
  const [pending, setPending] = useState<"share" | "unshare" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const area = useRef<HTMLElement>(null);
  const focusNext = useRef<FocusTarget>(null);
  const fieldId = useId();
  const published = listing !== null;

  // Move focus only after something the person did, once the new control is on screen.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target) area.current?.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus();
  }, [formOpen, published]);

  async function share(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending("share");
    setError(null);
    const result = await shareProgram(programId, name);
    setPending(null);
    if (!result.ok) return setError(result.message);
    focusNext.current = "copy";
    setFormOpen(false);
    setListing(result.program);
    setAnnouncement(`Shared as ${result.program.authorName}. Anyone with the link can start it, and it is listed in Courses.`);
  }

  async function unshare() {
    if (pending) return;
    setPending("unshare");
    setError(null);
    const result = await unshareProgram(programId);
    setPending(null);
    if (!result.ok) return setError(result.message);
    focusNext.current = "share";
    setListing(null);
    setAnnouncement("Made private. Only you can open this program now.");
  }

  return (
    <section
      ref={area}
      aria-labelledby="program-visibility"
      className="flex flex-col gap-3 rounded-sheet border border-rule-strong p-4 sm:px-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 text-ink-soft">
            {published ? <Globe size={20} /> : <Lock size={20} />}
          </span>
          <div className="min-w-0">
            <h2 id="program-visibility" className="font-semibold">
              {published ? "Shared program" : "Private program"}
            </h2>
            <p className="text-sm text-ink-soft">
              {published
                ? `Shared as ${listing.authorName}. Anyone with the link can start their own copy.`
                : "Only you can open it. Share it so others can follow the same path."}
            </p>
          </div>
        </div>
        {published ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="subtle" size="sm" pending={pending === "unshare"} onClick={unshare}>
              Make private
            </Button>
            <Link href="/courses" className={buttonClasses("quiet", "sm")}>
              View in Courses
            </Link>
          </div>
        ) : !formOpen && sharing.signInRequired ? (
          // Sharing puts a name on the program, so it needs a sign-in. Making it private never does.
          <SignInPrompt action="publish" />
        ) : (
          !formOpen && (
            <Button
              variant="subtle"
              size="sm"
              data-focus="share"
              onClick={() => {
                setError(null);
                focusNext.current = "field";
                setFormOpen(true);
              }}
            >
              Share program
            </Button>
          )
        )}
      </div>

      {!published && formOpen && (
        <form onSubmit={share} className="flex flex-wrap items-end gap-2">
          <Field id={fieldId} label="Name to show" hint="Leave empty to show Anonymous learner" className="min-w-0 flex-1 basis-56">
            {(control) => (
              <input
                {...control}
                data-focus="field"
                type="text"
                autoComplete="nickname"
                maxLength={sharing.maxNameLength}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={INPUT_CLASSES}
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" pending={pending === "share"}>
              Share
            </Button>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setError(null);
                focusNext.current = "share";
                setFormOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {published && <CopyLink programId={programId} />}

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}

/** The page's own address never changes, so there is nothing to subscribe to. */
const subscribeToNothing = () => () => {};

/** The program's full link in a read-only field, with a copy button. */
function CopyLink({ programId }: { programId: string }) {
  const origin = useSyncExternalStore(subscribeToNothing, () => window.location.origin, () => "");
  const url = `${origin}${programHref(programId)}`;
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const linkId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked: select the link so the person can copy it themselves.
      input.current?.select();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={linkId} className="sr-only">
        Program link
      </label>
      <input
        ref={input}
        id={linkId}
        readOnly
        value={url}
        onFocus={(event) => event.target.select()}
        className={`${INPUT_CLASSES} min-w-0 flex-1 basis-64 font-mono text-sm`}
      />
      <Button variant="secondary" size="sm" data-focus="copy" onClick={copy}>
        {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Link copied." : ""}
      </span>
    </div>
  );
}
