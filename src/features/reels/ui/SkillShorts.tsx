"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, ShortPlayer, ShortThumbnail } from "@/shared/ui";
import type { ShownReel, Vote, VoteResult } from "../types";

/** "1:05" from 65. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

async function fetchReels(mapId: string, nodeId: string): Promise<ShownReel[]> {
  try {
    const response = await fetch("/api/reels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId }),
    });
    const body = await response.json().catch(() => null);
    return response.ok && Array.isArray(body?.reels) ? (body.reels as ShownReel[]) : [];
  } catch {
    return [];
  }
}

async function sendVote(mapId: string, nodeId: string, videoId: string, vote: Vote): Promise<VoteResult | null> {
  try {
    const response = await fetch("/api/reels/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId, videoId, vote }),
    });
    return response.ok ? ((await response.json()) as VoteResult) : null;
  } catch {
    return null;
  }
}

/**
 * "Quick videos": a row of YouTube Shorts for one skill, at the end of its lesson. Tapping one
 * opens it over the page, with the others a tap or an arrow key away, and a like and a dislike.
 * A dislike hides the video from you once the viewer closes; enough dislikes remove it from the
 * course for everyone (on the server). Shows nothing until there are videos, and nothing at all
 * when there are none, since the lesson stands on its own.
 */
export function SkillShorts({ mapId, nodeId }: { mapId: string; nodeId: string }) {
  // Keyed, so opening another skill starts from a clean slate.
  return <ShortsRow key={`${mapId}/${nodeId}`} mapId={mapId} nodeId={nodeId} />;
}

function ShortsRow({ mapId, nodeId }: { mapId: string; nodeId: string }) {
  const [reels, setReels] = useState<ShownReel[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  // Tapping a video means you want to hear it; turning sound off holds for the rest of the row.
  const [sound, setSound] = useState(true);
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchReels(mapId, nodeId).then((found) => {
      if (!cancelled) setReels(found);
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, nodeId]);

  // Shown at once, then put right by the server's count; a failed vote goes back as it was.
  async function vote(videoId: string, next: Vote): Promise<boolean> {
    const before = reels.find((reel) => reel.videoId === videoId);
    if (!before) return false;
    const set = (myVote: Vote, likes: number) =>
      setReels((current) => current.map((reel) => (reel.videoId === videoId ? { ...reel, myVote, likes } : reel)));
    set(next, Math.max(0, before.likes + (next === 1 ? 1 : 0) - (before.myVote === 1 ? 1 : 0)));
    const result = await sendVote(mapId, nodeId, videoId, next);
    if (!result) {
      set(before.myVote, before.likes);
      return false;
    }
    set(result.myVote, result.likes);
    return true;
  }

  // Videos you disliked leave the row once the viewer closes, so a mis-tap can be undone first.
  function closeViewer() {
    setOpen(null);
    setReels((current) => current.filter((reel) => reel.myVote !== -1));
  }

  if (reels.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h4 id={headingId} className="font-display text-lg font-semibold lg:in-data-[reading-page]:text-2xl">
          Quick videos
        </h4>
        <p className="text-sm text-ink-soft lg:in-data-[reading-page]:text-base">Short clips on this skill, found on YouTube. Check important facts.</p>
      </div>
      <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-2">
        {reels.map((reel, index) => (
          <li key={reel.videoId} className="w-28 shrink-0 lg:in-data-[reading-page]:w-36">
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={`Watch "${reel.title}", ${clock(reel.seconds)}`}
              className="group flex w-full cursor-pointer flex-col gap-1.5 text-left"
            >
              <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-sheet bg-ink">
                <ShortThumbnail videoId={reel.videoId} className="transition-transform duration-200 motion-safe:group-hover:scale-105" />
                <span className="absolute right-1.5 bottom-1.5 rounded-sheet bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
                  {clock(reel.seconds)}
                </span>
              </span>
              <span className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline">{reel.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {open !== null && (
        <ShortsViewer reels={reels} index={open} onIndex={setOpen} onClose={closeViewer} onVote={vote} sound={sound} onSound={setSound} />
      )}
    </section>
  );
}

/** The player is as tall as the screen allows, at 9:16, and never wider than the screen. */
const PLAYER_WIDTH = "min(calc(100vw - 3rem), calc((96dvh - 17.5rem) * 9 / 16), 24rem)";

/** One Short over the page, with previous and next. Closing it removes the player, so the sound stops. */
function ShortsViewer({
  reels,
  index,
  onIndex,
  onClose,
  onVote,
  sound,
  onSound,
}: {
  reels: ShownReel[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onVote: (videoId: string, vote: Vote) => Promise<boolean>;
  sound: boolean;
  onSound: (on: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState("");
  const reel = reels[index];
  const hasPrevious = index > 0;
  const hasNext = index < reels.length - 1;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // A vote's message is about the video it was cast on.
  function go(next: number) {
    setStatus("");
    onIndex(next);
  }

  async function vote(next: Vote) {
    const videoId = reel.videoId;
    setStatus(next === 1 ? "Liked." : next === -1 ? "Disliked: hidden when you close this. Tap again to undo." : "Vote taken back.");
    if (!(await onVote(videoId, next))) setStatus("Your vote did not save. Please try again.");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // The dialog closes itself on Escape. Stop it there, or the map's own Escape closes the skill too.
    if (event.key === "Escape") {
      event.stopPropagation();
      return;
    }
    if (event.key === "ArrowLeft" && hasPrevious) go(index - 1);
    else if (event.key === "ArrowRight" && hasNext) go(index + 1);
    else return;
    event.preventDefault();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Video ${index + 1} of ${reels.length}: ${reel.title}`}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto max-h-[96dvh] overflow-y-auto rounded-sheet border border-control-edge bg-sheet p-3 text-ink backdrop:bg-black/80 sm:p-4"
    >
      <div className="flex flex-col gap-3" style={{ width: PLAYER_WIDTH }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-soft tabular-nums" aria-live="polite">
            {index + 1} of {reels.length}
          </p>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close video"
            className="-m-1 flex size-10 cursor-pointer items-center justify-center rounded-control text-ink hover:bg-raised"
          >
            <X aria-hidden="true" size={22} />
          </button>
        </div>
        <ShortPlayer key={reel.videoId} videoId={reel.videoId} title={reel.title} playing sound={sound} onSound={onSound} className="w-full rounded-sheet" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-semibold leading-snug">{reel.title}</p>
            <a
              href={`https://www.youtube.com/shorts/${reel.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-ink-soft underline-offset-2 hover:text-ink hover:underline"
              aria-label={`${reel.channel} on YouTube (opens a new tab)`}
            >
              {reel.channel} on YouTube
            </a>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <VoteButton
              label={reel.myVote === 1 ? `Take back your like, ${reel.likes} likes` : `Like, ${reel.likes} likes`}
              pressed={reel.myVote === 1}
              onClick={() => void vote(reel.myVote === 1 ? 0 : 1)}
            >
              <ThumbsUp aria-hidden="true" size={18} className={clsx(reel.myVote === 1 && "fill-current")} />
              <span className="tabular-nums">{reel.likes}</span>
            </VoteButton>
            <VoteButton
              label={reel.myVote === -1 ? "Take back your dislike" : "Dislike: not helpful for this skill"}
              pressed={reel.myVote === -1}
              onClick={() => void vote(reel.myVote === -1 ? 0 : -1)}
            >
              <ThumbsDown aria-hidden="true" size={18} className={clsx(reel.myVote === -1 && "fill-current")} />
            </VoteButton>
          </div>
          {reels.length > 1 && (
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={() => go(index - 1)} disabled={!hasPrevious} aria-label="Previous video">
                <ChevronLeft aria-hidden="true" size={18} />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => go(index + 1)} disabled={!hasNext} aria-label="Next video">
                <ChevronRight aria-hidden="true" size={18} />
              </Button>
            </div>
          )}
        </div>
        <p className="min-h-5 text-sm text-ink-soft" aria-live="polite">
          {status}
        </p>
      </div>
    </dialog>
  );
}

/** Like or dislike: an outlined button, solid ink while it is your vote. */
function VoteButton({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={clsx(
        "flex min-h-10 min-w-10 cursor-pointer items-center justify-center gap-1.5 rounded-control px-2.5 text-sm font-semibold shadow-[inset_0_0_0_1.5px_var(--color-control-edge)] transition-colors",
        pressed ? "bg-ink text-on-ink" : "text-ink hover:bg-raised",
      )}
    >
      {children}
    </button>
  );
}
