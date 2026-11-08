"use client";

import { Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Spinner } from "@/shared/ui";
import { commentProblem, MAX_COMMENT_LENGTH } from "../commentRules";
import type { FeedComment } from "../types";

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, (now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))} d ago`;
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

type Props = {
  itemId: string;
  itemTitle: string;
  onClose: () => void;
  /** +1 after a post, -1 after a delete, so the rail count follows. */
  onCount: (change: number) => void;
};

/**
 * Public comments on one card or Short: a sheet from the bottom on phones, a side panel on
 * desktop. A native modal dialog, so focus stays inside and Escape closes it. Plain text only.
 */
export function CommentsPanel({ itemId, itemTitle, onClose, onCount }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState("");
  const headingId = useId();
  const inputId = useId();

  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      const response = await fetch(`/api/feed/comments?itemId=${encodeURIComponent(itemId)}`).catch(() => null);
      const data = await response?.json().catch(() => null);
      if (!live) return;
      if (!response?.ok || !data) setLoadError(data?.error ?? "Comments could not be loaded just now.");
      else setComments(data.comments as FeedComment[]);
    })();
    return () => {
      live = false;
    };
  }, [itemId]);

  async function post(event: React.FormEvent) {
    event.preventDefault();
    const problem = commentProblem(text);
    if (problem) {
      setError(problem);
      return;
    }
    setPosting(true);
    setError("");
    const response = await fetch("/api/feed/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, text }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setPosting(false);
    if (!response?.ok || !data?.comment) {
      setError(data?.error ?? "That comment did not post. Please try again.");
      return;
    }
    setComments((before) => [data.comment as FeedComment, ...(before ?? [])]);
    setText("");
    setNote("Your comment is posted.");
    onCount(1);
  }

  async function remove(comment: FeedComment) {
    const response = await fetch("/api/feed/comments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, commentId: comment.id }),
    }).catch(() => null);
    if (!response?.ok) {
      setNote("That comment could not be deleted. Please try again.");
      return;
    }
    setComments((before) => (before ?? []).filter((old) => old.id !== comment.id));
    setNote("Your comment is deleted.");
    onCount(-1);
    input.current?.focus();
  }

  const left = MAX_COMMENT_LENGTH - text.trim().length;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={headingId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      className="m-0 mt-auto h-[78dvh] open:flex max-h-none w-full max-w-none flex-col border-t-[1.5px] border-ink bg-sheet p-0 text-ink backdrop:bg-ink/40 lg:mt-0 lg:ml-auto lg:h-dvh lg:w-[420px] lg:border-t-0 lg:border-l-[1.5px]"
    >
      <div className="flex items-start gap-3 border-b border-rule px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-xl font-bold font-stretch-[112%]">
            Comments
          </h2>
          <p className="truncate text-sm text-ink-soft">{itemTitle}</p>
        </div>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="Close comments"
          className="-mt-1 -mr-1 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-control hover:bg-raised"
        >
          <X aria-hidden="true" size={22} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {comments === null && !loadError && (
          <p className="flex items-center gap-2 text-ink-soft">
            <Spinner /> Loading comments.
          </p>
        )}
        {loadError && <p className="text-danger">{loadError}</p>}
        {comments?.length === 0 && <p className="text-ink-soft">No comments yet. Say what you think, or ask a question.</p>}
        {comments && comments.length > 0 && (
          <ol className="flex flex-col gap-4" aria-label="Newest first">
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-semibold">{comment.mine ? `${comment.name} (you)` : comment.name}</span>{" "}
                    <time dateTime={comment.at} className="text-ink-soft">
                      {timeAgo(comment.at)}
                    </time>
                  </p>
                  <p className="mt-0.5 break-words whitespace-pre-wrap">{comment.text}</p>
                </div>
                {comment.mine && (
                  <button
                    type="button"
                    onClick={() => void remove(comment)}
                    aria-label="Delete your comment"
                    className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-soft hover:bg-raised hover:text-ink"
                  >
                    <Trash2 aria-hidden="true" size={18} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <form onSubmit={(event) => void post(event)} className="border-t border-rule px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]" noValidate>
        <label htmlFor={inputId} className="sr-only">
          Add a public comment
        </label>
        <textarea
          ref={input}
          id={inputId}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          maxLength={MAX_COMMENT_LENGTH + 20}
          placeholder="Add a public comment"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${inputId}-help`}
          className="w-full resize-none rounded-control border-[1.5px] border-control-edge bg-sheet px-3 py-2 text-base text-ink placeholder:text-ink-soft"
        />
        <div className="mt-2 flex items-center gap-3">
          <p id={`${inputId}-help`} className="min-w-0 flex-1 text-sm" aria-live="polite">
            {error ? <span className="font-semibold text-danger">{error}</span> : <span className={left < 0 ? "font-semibold text-danger" : "text-ink-soft"}>{left} characters left. Everyone can see comments.</span>}
          </p>
          <Button type="submit" size="sm" disabled={posting || text.trim().length === 0}>
            {posting ? "Posting" : "Post"}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">
          {note}
        </p>
      </form>
    </dialog>
  );
}
