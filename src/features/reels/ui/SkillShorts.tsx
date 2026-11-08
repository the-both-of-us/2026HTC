"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, ShortPlayer, ShortThumbnail } from "@/shared/ui";
import type { Reel } from "../types";

/** "1:05" from 65. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

async function fetchReels(mapId: string, nodeId: string): Promise<Reel[]> {
  try {
    const response = await fetch("/api/reels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId }),
    });
    const body = await response.json().catch(() => null);
    return response.ok && Array.isArray(body?.reels) ? (body.reels as Reel[]) : [];
  } catch {
    return [];
  }
}

/**
 * "Quick videos": a row of YouTube Shorts for one skill, at the end of its lesson. Tapping one
 * opens it over the page, with the others a tap or an arrow key away. Shows nothing until there
 * are videos, and nothing at all when there are none, since the lesson stands on its own.
 */
export function SkillShorts({ mapId, nodeId }: { mapId: string; nodeId: string }) {
  // Keyed, so opening another skill starts from a clean slate.
  return <ShortsRow key={`${mapId}/${nodeId}`} mapId={mapId} nodeId={nodeId} />;
}

function ShortsRow({ mapId, nodeId }: { mapId: string; nodeId: string }) {
  const [reels, setReels] = useState<Reel[]>([]);
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
      {open !== null && <ShortsViewer reels={reels} index={open} onIndex={setOpen} onClose={() => setOpen(null)} sound={sound} onSound={setSound} />}
    </section>
  );
}

/** The player is as tall as the screen allows, at 9:16, and never wider than the screen. */
const PLAYER_WIDTH = "min(calc(100vw - 3rem), calc((96dvh - 10rem) * 9 / 16), 24rem)";

/** One Short over the page, with previous and next. Closing it removes the player, so the sound stops. */
function ShortsViewer({
  reels,
  index,
  onIndex,
  onClose,
  sound,
  onSound,
}: {
  reels: Reel[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  sound: boolean;
  onSound: (on: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reel = reels[index];
  const hasPrevious = index > 0;
  const hasNext = index < reels.length - 1;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "ArrowLeft" && hasPrevious) onIndex(index - 1);
    else if (event.key === "ArrowRight" && hasNext) onIndex(index + 1);
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
          {reels.length > 1 && (
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={() => onIndex(index - 1)} disabled={!hasPrevious} aria-label="Previous video">
                <ChevronLeft aria-hidden="true" size={18} />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onIndex(index + 1)} disabled={!hasNext} aria-label="Next video">
                <ChevronRight aria-hidden="true" size={18} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
