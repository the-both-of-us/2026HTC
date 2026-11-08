"use client";

import clsx from "clsx";
import { ArrowUpRight, ChevronDown, ChevronUp, Clapperboard, Play, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ShortPlayer, ShortThumbnail } from "@/shared/ui";
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
      <div className="flex items-center justify-between gap-3">
        <h4 id={headingId} className="flex items-center gap-2.5 font-display text-lg font-semibold lg:in-data-[reading-page]:text-2xl">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink/10 text-ink">
            <Clapperboard size={17} />
          </span>
          Quick videos
        </h4>
        <button
          type="button"
          onClick={() => setOpen(0)}
          className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--color-control-edge)] transition-colors hover:bg-raised"
        >
          <Play aria-hidden="true" size={15} className="fill-current" />
          Play all
        </button>
      </div>
      <p className="-mt-1 text-sm text-ink-soft">
        {reels.length === 1 ? "1 short clip" : `${reels.length} short clips`} from YouTube. Check important facts.
      </p>
      <ul className="-mx-1 flex snap-x snap-mandatory scroll-px-1 gap-3 overflow-x-auto px-1 pt-1 pb-3 [scrollbar-width:thin]">
        {reels.map((reel, index) => (
          <li key={reel.videoId} className="w-36 shrink-0 snap-start sm:w-40 lg:in-data-[reading-page]:w-44">
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={`Watch "${reel.title}" by ${reel.channel}, ${clock(reel.seconds)}`}
              className="group relative block aspect-[9/16] w-full cursor-pointer overflow-hidden rounded-xl bg-ink text-left shadow-sm transition duration-200 hover:shadow-lg motion-safe:hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <ShortThumbnail videoId={reel.videoId} className="transition-transform duration-300 motion-safe:group-hover:scale-105" />
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/90 via-black/40 to-transparent" />
              <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[0.6875rem] font-semibold text-white tabular-nums backdrop-blur-sm">
                {clock(reel.seconds)}
              </span>
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 scale-90 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition duration-200 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                <Play size={18} className="ml-0.5 fill-current" />
              </span>
              <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2.5">
                <span className="line-clamp-2 text-[0.8125rem] leading-snug font-semibold text-white">{reel.title}</span>
                <span className="flex items-center gap-1 truncate text-[0.6875rem] text-white/75">
                  <span className="truncate">{reel.channel}</span>
                  {reel.likes > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      · <ThumbsUp aria-hidden="true" size={11} /> {reel.likes}
                    </span>
                  )}
                </span>
              </span>
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

/** Beside the video: the rail's width. */
const RAIL = "3.5rem";
/**
 * The player is as tall as the screen allows, at 9:16, and never wider than the screen. 10rem is
 * the room for the counter above it and the title below, plus the padding.
 */
const PLAYER_WIDTH = `min(calc(100vw - 2rem - ${RAIL}), calc((100dvh - 10rem) * 9 / 16), 26rem)`;

/**
 * One Short full screen over a dimmed page, like the feed: a rail beside it with like, dislike
 * and previous and next, and its title and channel below it. The title sits under the video, not
 * on it, since YouTube's captions and many Shorts' own text fill the bottom of the frame. Closing it removes the player, so
 * the sound stops.
 */
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
  const close = () => dialogRef.current?.close();

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
    setStatus(next === 1 ? "Liked" : next === -1 ? "Disliked: hidden when you close this. Tap again to undo." : "Vote taken back");
    if (!(await onVote(videoId, next))) setStatus("Your vote did not save. Please try again.");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // The dialog closes itself on Escape. Stop it there, or the map's own Escape closes the skill too.
    if (event.key === "Escape") {
      event.stopPropagation();
      return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && hasPrevious) go(index - 1);
    else if ((event.key === "ArrowRight" || event.key === "ArrowDown") && hasNext) go(index + 1);
    else return;
    event.preventDefault();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Video ${index + 1} of ${reels.length}: ${reel.title}`}
      onClose={onClose}
      onKeyDown={onKeyDown}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-white backdrop:bg-black/90 backdrop:backdrop-blur-sm"
    >
      {/* A tap on the dark space around the video closes it. */}
      <div className="flex size-full items-center justify-center p-4" onClick={(event) => event.target === event.currentTarget && close()}>
        <div className="flex flex-col gap-3" style={{ width: `calc(${PLAYER_WIDTH} + ${RAIL})` }}>
          <div className="flex items-center justify-between">
            <p className="rounded-full bg-white/10 px-3 py-1 text-sm font-semibold tabular-nums">
              {index + 1} / {reels.length}
            </p>
            <button type="button" onClick={close} aria-label="Close video" className={railButton}>
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          <div className="flex items-end gap-2">
            <ShortPlayer
              key={reel.videoId}
              videoId={reel.videoId}
              title={reel.title}
              playing
              sound={sound}
              onSound={onSound}
              className="rounded-2xl shadow-2xl"
              style={{ width: PLAYER_WIDTH }}
            />
            <div className="flex w-12 shrink-0 flex-col items-center gap-2 pb-1">
              <RailButton
                label={reel.myVote === 1 ? `Take back your like, ${reel.likes} likes` : `Like, ${reel.likes} likes`}
                pressed={reel.myVote === 1}
                onClick={() => void vote(reel.myVote === 1 ? 0 : 1)}
                count={reel.likes}
              >
                <ThumbsUp aria-hidden="true" size={20} className={clsx(reel.myVote === 1 && "fill-current")} />
              </RailButton>
              <RailButton
                label={reel.myVote === -1 ? "Take back your dislike" : "Dislike: not helpful for this skill"}
                pressed={reel.myVote === -1}
                onClick={() => void vote(reel.myVote === -1 ? 0 : -1)}
              >
                <ThumbsDown aria-hidden="true" size={20} className={clsx(reel.myVote === -1 && "fill-current")} />
              </RailButton>
              {reels.length > 1 && (
                <>
                  <span aria-hidden="true" className="my-1 h-px w-6 bg-white/20" />
                  <RailButton label="Previous video" onClick={() => go(index - 1)} disabled={!hasPrevious}>
                    <ChevronUp aria-hidden="true" size={22} />
                  </RailButton>
                  <RailButton label="Next video" onClick={() => go(index + 1)} disabled={!hasNext}>
                    <ChevronDown aria-hidden="true" size={22} />
                  </RailButton>
                </>
              )}
            </div>
          </div>
          <div className="min-w-0" style={{ width: PLAYER_WIDTH }}>
            <p className="truncate font-semibold leading-snug" title={reel.title}>
              {reel.title}
            </p>
            <a
              href={`https://www.youtube.com/shorts/${reel.videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex max-w-full items-center gap-1 text-sm text-white/70 underline-offset-2 hover:text-white hover:underline"
              aria-label={`${reel.channel} on YouTube (opens a new tab)`}
            >
              <span className="truncate">{reel.channel} on YouTube</span>
              <ArrowUpRight aria-hidden="true" size={14} className="shrink-0" />
            </a>
          </div>
        </div>
      </div>
      <p
        aria-live="polite"
        className={clsx(
          "pointer-events-none fixed top-5 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 text-center text-sm font-medium shadow-lg backdrop-blur-sm transition-opacity",
          status ? "opacity-100" : "opacity-0",
        )}
      >
        {status}
      </p>
    </dialog>
  );
}

/** The round buttons beside the video. White on the dark backdrop in every theme, like the video's own. */
const railButton =
  "flex size-11 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-35 disabled:hover:bg-white/10";

function RailButton({
  label,
  pressed,
  count,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  /** Shown under the button. The label already says it for screen readers. */
  count?: number;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={clsx(railButton, pressed && "bg-white! text-black!")}
      >
        {children}
      </button>
      {count !== undefined && <span className="text-xs font-semibold tabular-nums">{count}</span>}
    </div>
  );
}
