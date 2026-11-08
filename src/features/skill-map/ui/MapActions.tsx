"use client";

import clsx from "clsx";
import { Ellipsis } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui";

/**
 * The header's buttons. On a large screen they sit in one row. On a phone only the primary
 * (the next skill) and a "More" button show, and More opens the rest as a labelled list, so
 * the header stays one short row and the map starts high on the screen. The buttons are
 * rendered once either way, so their dialogs and state are the same on both.
 */
export function MapActions({ more, primary }: { more: ReactNode; primary?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Close on a tap elsewhere or Escape, like the other small popovers in the header.
  useEffect(() => {
    if (!open) return;
    function close(event: Event) {
      if (event instanceof KeyboardEvent) {
        // A dialog opened from the menu handles its own Escape.
        if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
        setOpen(false);
        rootRef.current?.querySelector<HTMLElement>("[data-more-button]")?.focus();
      } else if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative flex items-center gap-2 max-sm:w-full [&_button]:min-h-9! [&_button]:text-sm! [&_summary]:min-h-9!"
    >
      <div
        id={panelId}
        className={clsx(
          // Phone: a labelled list under the More button. Larger: the usual row of buttons.
          "z-30 items-stretch gap-1 max-sm:absolute max-sm:top-full max-sm:right-0 max-sm:mt-1.5 max-sm:w-64 max-sm:flex-col max-sm:rounded-control max-sm:border max-sm:border-rule-strong max-sm:bg-sheet max-sm:p-2 max-sm:shadow-panel",
          "max-sm:[&>*]:w-full max-sm:[&>*>button]:w-full max-sm:[&>button]:justify-start max-sm:[&>*>button]:justify-start max-sm:[&_summary]:w-full max-sm:[&_summary]:justify-start",
          "sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:[&_button]:px-3! sm:[&_summary]:px-3!",
          open ? "flex" : "max-sm:hidden",
        )}
      >
        {more}
      </div>
      {primary && <div className="flex min-w-0 grow sm:grow-0 [&>button]:grow [&>button]:px-3!">{primary}</div>}
      <Button
        variant="subtle"
        size="sm"
        data-more-button
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="shrink-0 px-2.5! sm:hidden"
      >
        <Ellipsis aria-hidden="true" size={18} />
        More
      </Button>
    </div>
  );
}
