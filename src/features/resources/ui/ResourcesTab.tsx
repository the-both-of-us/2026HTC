"use client";

import { BookOpen, ExternalLink, Newspaper, Play, Podcast } from "lucide-react";
/* eslint-disable @next/next/no-img-element -- thumbnails come from several outside hosts */
import { useEffect, useState } from "react";
import { Button, ErrorNotice } from "@/shared/ui";
import type { ResourceItem, ResourceKind } from "../types";

type Phase = { kind: "loading" } | { kind: "ready"; items: ResourceItem[] } | { kind: "error"; message: string };

const GROUPS: { kind: ResourceKind; heading: string }[] = [
  { kind: "watch", heading: "Watch" },
  { kind: "read", heading: "Read" },
  { kind: "listen", heading: "Listen" },
  { kind: "news", heading: "News" },
];

const ICONS = { watch: Play, read: BookOpen, listen: Podcast, news: Newspaper } as const;

/** The Resources tab: links to videos, reading, podcasts and news for one skill, found when the tab opens. */
export function ResourcesTab({ mapId, nodeId }: { mapId: string; nodeId: string }) {
  return <ResourcesBody key={`${mapId}/${nodeId}`} mapId={mapId} nodeId={nodeId} />;
}

function ResourcesBody({ mapId, nodeId }: { mapId: string; nodeId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, nodeId }),
      signal: AbortSignal.timeout(20_000),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (response.ok && Array.isArray(body?.items)) return { kind: "ready", items: body.items } as Phase;
        return { kind: "error", message: typeof body?.error === "string" ? body.error : "The resources could not be loaded this time. Please try again." } as Phase;
      })
      .catch(() => ({ kind: "error", message: "OryxLearn could not be reached. Check your connection, then try again." }) as Phase)
      .then((next) => !cancelled && setPhase(next));
    return () => {
      cancelled = true;
    };
  }, [mapId, nodeId, attempt]);

  if (phase.kind === "loading") return <Skeleton />;
  if (phase.kind === "error") {
    return (
      <ErrorNotice
        message={phase.message}
        onRetry={() => {
          setPhase({ kind: "loading" });
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  if (phase.items.length === 0) {
    return (
      <p className="max-w-[65ch] text-ink-soft">
        We found nothing for this skill. The sources may be busy, or the skill may be too specific. The Read tab has the lesson.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map(({ kind, heading }) => {
        const items = phase.items.filter((item) => item.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} aria-label={heading} className="flex flex-col gap-2">
            <h4 className="font-display text-lg font-semibold">{heading}</h4>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <ResourceRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
      <p className="text-sm text-ink-soft">Links go to other sites and were found by search, not checked by OryxLearn.</p>
    </div>
  );
}

function ResourceRow({ item }: { item: ResourceItem }) {
  const [playing, setPlaying] = useState(false);
  const Icon = ICONS[item.kind];
  const shape = item.kind === "read" || item.kind === "listen" ? "h-16 w-12" : "h-14 w-24";

  return (
    <li className="flex flex-col gap-3 rounded-sheet border border-rule-strong bg-sheet p-3">
      <div className="flex items-start gap-3">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" loading="lazy" className={`${shape} shrink-0 rounded-control border border-rule bg-raised object-cover`} />
        ) : (
          <span className={`${shape} flex shrink-0 items-center justify-center rounded-control bg-raised text-ink-soft`}>
            <Icon aria-hidden="true" size={20} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1.5 font-medium text-accent-bright underline underline-offset-4"
          >
            <span className="min-w-0">{item.title}</span>
            <ExternalLink aria-hidden="true" size={14} className="mt-1.5 shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {item.by && <p className="text-sm text-ink-soft">{item.by}</p>}
          {item.summary && <p className="line-clamp-2 text-sm text-ink-soft">{item.summary}</p>}
        </div>
        {item.videoId && !playing && (
          <Button variant="subtle" onClick={() => setPlaying(true)} className="shrink-0">
            <Play aria-hidden="true" size={16} />
            Play here
          </Button>
        )}
      </div>
      {item.videoId && playing && (
        <iframe
          title={item.title}
          src={`https://www.youtube-nocookie.com/embed/${item.videoId}?autoplay=1&rel=0`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video w-full rounded-control border border-rule-strong"
        />
      )}
    </li>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Looking for videos, reading and more for this skill.</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} aria-hidden="true" className="flex animate-pulse gap-3 rounded-sheet border border-rule bg-sheet p-3">
          <div className="h-14 w-24 shrink-0 rounded-control bg-raised" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-3/4 rounded-sm bg-raised" />
            <div className="h-3 w-1/3 rounded-sm bg-raised" />
          </div>
        </div>
      ))}
    </div>
  );
}
