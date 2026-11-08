"use client";

import clsx from "clsx";
import { HandHeart, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Seal } from "@/shared/ui";

export type Toast = {
  id: string;
  kind: "proof" | "cheer" | "error";
  /** What it says, as one sentence: the live region reads exactly this. */
  text: string;
  /** For a proof's seal: the skill id. */
  fingerprint?: string;
};

const SHOW_MS = 6500;
const MAX_SHOWN = 3;

/** A small stack of toasts, newest at the bottom, each gone after a few seconds. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Toast) => {
      setToasts((current) => [...current.filter((shown) => shown.id !== toast.id), toast].slice(-MAX_SHOWN));
      clearTimeout(timers.current.get(toast.id));
      timers.current.set(
        toast.id,
        setTimeout(() => dismiss(toast.id), SHOW_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  return { toasts, push, dismiss };
}

/**
 * Where the toasts appear: bottom right on a big screen, along the bottom on a phone. The
 * region is always in the page, so screen readers announce each new toast once.
 */
export function CircleToasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[25rem]"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            "circle-toast pointer-events-auto flex items-center gap-3 rounded-sheet border-[1.5px] bg-sheet py-3 pr-2 pl-3.5 text-ink",
            toast.kind === "error" ? "border-danger" : toast.kind === "cheer" ? "border-ink" : "border-proven",
          )}
        >
          {toast.kind === "proof" && <Seal fingerprint={toast.fingerprint ?? toast.id} size={34} className="shrink-0" />}
          {toast.kind === "cheer" && (
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-ink text-on-ink">
              <HandHeart aria-hidden="true" size={19} />
            </span>
          )}
          <p className="min-w-0 flex-1 text-[1.0625rem] leading-snug font-medium">{toast.text}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-soft hover:bg-raised hover:text-ink"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>
      ))}
    </div>
  );
}
