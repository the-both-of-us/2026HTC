"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClasses } from "@/shared/ui";

/**
 * Deletes one of your courses from its Dashboard card. The card is a link, so this sits on top
 * of it as a sibling: a small button on the cover, then a confirm panel over the whole card
 * (two steps on the page, no browser dialog). Calls `DELETE /api/maps/[id]`.
 */
export function DeleteCourseButton({ mapId, title }: { mapId: string; title: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  // Focus "Keep it" when the panel opens, and return to the trash button when it closes.
  useEffect(() => {
    if (asking) keepButton.current?.focus();
    else if (wasAsking.current) openButton.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/maps/${mapId}`, { method: "DELETE" });
      if (response.ok || response.status === 404) {
        setGone(true);
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The course could not be deleted. Try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (gone) {
    return (
      <div role="status" className="absolute inset-0 flex items-center justify-center rounded-xl border border-rule-strong bg-sheet p-5 text-sm text-ink-soft">
        Deleted “{title}”.
      </div>
    );
  }

  if (!asking) {
    return (
      <button
        ref={openButton}
        type="button"
        onClick={() => setAsking(true)}
        aria-label={`Delete “${title}”`}
        title="Delete course"
        className="absolute top-2.5 right-2.5 inline-flex size-9 cursor-pointer items-center justify-center rounded-full bg-sheet/85 text-ink-soft shadow-sm transition-control hover:bg-danger-surface hover:text-danger focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Trash2 aria-hidden="true" size={16} />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Delete “${title}”`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) setAsking(false);
      }}
      className="absolute inset-0 flex flex-col justify-center gap-3 overflow-y-auto rounded-xl border border-danger/40 bg-danger-surface p-5"
    >
      <p className="text-sm">
        <span className="font-semibold">Delete “{title}”</span> and your progress on it?{" "}
        Copies in study circles you started stay with their members. This can&apos;t be undone.
      </p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button size="sm" onClick={remove} disabled={busy} className="bg-danger! text-paper! shadow-none! hover:opacity-90">
          {busy ? "Deleting…" : "Delete for good"}
        </Button>
        <button
          ref={keepButton}
          type="button"
          className={buttonClasses("subtle", "sm")}
          onClick={() => setAsking(false)}
          disabled={busy}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
