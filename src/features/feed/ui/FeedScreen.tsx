"use client";

import clsx from "clsx";
import { ArrowUpRight, Bookmark, Heart, Play, Share2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, buttonClasses, ErrorNotice, PageShell, prefersReducedMotion, Spinner } from "@/shared/ui";
import type { FeedCard, FeedItem, FeedPage, FeedShort, Interest } from "../types";
import { InterestPicker } from "./InterestPicker";

type View = "for-you" | "saved";
type Status = "loading" | "ready" | "picking" | "error";

/** "Go deeper": the landing with the subtopic filled in, to build a real course from it. */
const deeperHref = (subtopic: string) => `/?topic=${encodeURIComponent(subtopic)}`;

/** Engagement goes with sendBeacon (or a keepalive fetch) and never blocks the feed. */
function sendEvent(body: { itemId: string; event: "view"; dwellMs: number } | { itemId: string; event: "share" | "deeper" }) {
  const json = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.("/api/feed/event", new Blob([json], { type: "application/json" }))) return;
  } catch {
    // Fall through to fetch.
  }
  void fetch("/api/feed/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(() => {});
}

/** On screen means at least 60% visible. Shorter than this is not counted at all. */
const MIN_REPORT_MS = 300;

async function fetchPage(view: View, exclude: string[]): Promise<FeedPage> {
  const params = new URLSearchParams();
  if (exclude.length > 0) params.set("exclude", exclude.slice(-120).join(","));
  if (view === "saved") params.set("view", "saved");
  const response = await fetch(`/api/feed?${params}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "The feed could not be loaded just now. Please try again.");
  return data as FeedPage;
}

/** The "For you" feed at /feed: one idea per screen, swiped up like reels, each with a way to prove it. */
export function FeedScreen() {
  const [view, setView] = useState<View>("for-you");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [more, setMore] = useState(false);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  const load = useCallback(async (nextView: View) => {
    setStatus("loading");
    try {
      const page = await fetchPage(nextView, []);
      setInterests(page.interests);
      if (page.needsInterests) {
        setStatus("picking");
        return;
      }
      setItems(page.items);
      setMore(page.more);
      setCurrent(0);
      setStatus("ready");
      scroller.current?.scrollTo({ top: 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The feed could not be loaded just now.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // The first page comes from the server once the screen is in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(view);
  }, [load, view]);

  const loadMore = useCallback(async () => {
    if (!more || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await fetchPage(view, items.map((item) => item.id));
      const seen = new Set(items.map((item) => item.id));
      const fresh = page.items.filter((item) => !seen.has(item.id));
      setItems((before) => [...before, ...fresh.filter((item) => !before.some((old) => old.id === item.id))]);
      setMore(page.more && fresh.length > 0);
    } catch {
      // The next page will be tried again on the next swipe.
    } finally {
      loadingMore.current = false;
    }
  }, [more, items, view]);

  // Which card fills the screen, to fetch the next page before the end, and how long each item
  // stays on screen (at least 60% visible), reported when it leaves or the page is hidden.
  const onScreenSince = useRef(new Map<string, number>());
  useEffect(() => {
    const root = scroller.current;
    if (!root || status !== "ready") return;
    const since = onScreenSince.current;
    const report = (id: string) => {
      const start = since.get(id);
      since.delete(id);
      if (start === undefined || view === "saved") return;
      const dwellMs = Math.round(performance.now() - start);
      if (dwellMs >= MIN_REPORT_MS) sendEvent({ itemId: id, event: "view", dwellMs: Math.min(dwellMs, 3_600_000) });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          const id = element.dataset.itemId;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            if (id && !since.has(id) && document.visibilityState === "visible") since.set(id, performance.now());
            const index = Number(element.dataset.index);
            setCurrent(index);
            if (index >= items.length - 3) void loadMore();
          } else if (id) {
            report(id);
          }
        }
      },
      { root, threshold: [0, 0.6] },
    );
    root.querySelectorAll("[data-index]").forEach((element) => observer.observe(element));
    const onHide = () => {
      if (document.visibilityState === "hidden") for (const id of [...since.keys()]) report(id);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onHide);
      for (const id of [...since.keys()]) report(id);
    };
  }, [items, status, loadMore, view]);

  // Arrow keys and j/k move one card, unless the learner is typing somewhere.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
      const root = scroller.current;
      if (!step || !root) return;
      event.preventDefault();
      const cards = root.querySelectorAll<HTMLElement>("[data-index]");
      const next = cards[Math.min(Math.max(current + step, 0), cards.length - 1)];
      next?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  const react = useCallback(async (card: FeedCard, reaction: "like" | "save") => {
    const field = reaction === "like" ? "liked" : "saved";
    const on = !card[field];
    const flip = (value: boolean) =>
      setItems((before) => before.map((item) => (item.id === card.id ? { ...item, [field]: value } : item)));
    flip(on);
    setAnnouncement(
      reaction === "like"
        ? on ? `Liked "${card.title}".` : `Removed your like from "${card.title}".`
        : on ? `Saved "${card.title}". Find it under Saved.` : `Removed "${card.title}" from Saved.`,
    );
    const response = await fetch(`/api/feed/${reaction}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: card.id, on }),
    }).catch(() => null);
    if (!response?.ok) {
      flip(!on);
      setAnnouncement("That did not save. Please try again.");
    }
  }, []);

  const share = useCallback(async (item: FeedItem) => {
    sendEvent({ itemId: item.id, event: "share" });
    const url = `${window.location.origin}${deeperHref(item.subtopic)}`;
    const title = item.kind === "card" ? item.title : item.short.title;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: item.kind === "card" ? item.body : `${title}, on OryxLearn`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setAnnouncement("Link copied.");
    } catch (caught) {
      // Closing the share sheet is not an error.
      if (caught instanceof Error && caught.name === "AbortError") return;
      setAnnouncement("Could not share from this browser. Copy the address instead.");
    }
  }, []);

  const textCards = items.filter((item) => item.kind === "card");

  return (
    <PageShell width="full">
      <style>{`@keyframes feed-pop{0%{transform:scale(1)}40%{transform:scale(1.3)}100%{transform:scale(1)}}`}</style>
      <div className="flex h-[calc(100dvh-3.5rem-1px)] flex-col lg:h-dvh">
        <h1 className="sr-only">For you</h1>
        {status !== "picking" && (
        <div className="mx-auto flex w-full max-w-[460px] items-center justify-between gap-3 px-4 pt-3 pb-2 lg:px-0 lg:pt-5">
          <div className="flex gap-5" role="group" aria-label="Which cards">
            {(
              [
                ["for-you", "For you"],
                ["saved", "Saved"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={clsx(
                  "min-h-10 cursor-pointer text-base font-semibold font-stretch-[108%] underline-offset-[6px]",
                  view === value ? "text-ink underline decoration-2" : "text-ink-soft hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {interests.length > 0 && (
            <button type="button" onClick={() => setStatus("picking")} className={buttonClasses("quiet", "sm")}>
              Edit interests
            </button>
          )}
        </div>
        )}

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        {status === "loading" && (
          <div className="flex flex-1 items-center justify-center gap-3 text-ink-soft">
            <Spinner /> Finding ideas for you.
          </div>
        )}
        {status === "picking" && (
          <InterestPicker
            key={interests.map((interest) => interest.slug).join(",")}
            initial={interests}
            onCancel={interests.length > 0 ? () => (items.length > 0 ? setStatus("ready") : void load(view)) : undefined}
            onDone={(saved) => {
              setInterests(saved);
              setView("for-you");
              void load("for-you");
            }}
          />
        )}
        {status === "error" && (
          <div className="mx-auto w-full max-w-[460px] px-4 lg:px-0">
            <ErrorNotice message={error} onRetry={() => void load(view)} />
          </div>
        )}

        {status === "ready" && (
          <div
            ref={scroller}
            className="min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain motion-safe:scroll-smooth"
            aria-label="Cards. Use the arrow keys or J and K to move."
            tabIndex={0}
          >
            {items.map((item, index) => (
              <section
                key={item.id}
                data-index={index}
                data-item-id={item.id}
                aria-roledescription="card"
                aria-label={item.kind === "card" ? item.title : `Video: ${item.short.title}`}
                className="mx-auto flex h-full w-full max-w-[460px] snap-start snap-always px-3 pb-3 lg:px-0 lg:pb-5"
              >
                {item.kind === "card" ? (
                  <TopicCard
                    card={item}
                    onLike={() => void react(item, "like")}
                    onSave={() => void react(item, "save")}
                    onShare={() => void share(item)}
                    onDeeper={() => sendEvent({ itemId: item.id, event: "deeper" })}
                  />
                ) : (
                  <ShortCard item={item} onShare={() => void share(item)} onDeeper={() => sendEvent({ itemId: item.id, event: "deeper" })} />
                )}
              </section>
            ))}
            <section
              data-index={items.length}
              className="mx-auto flex h-full w-full max-w-[460px] snap-start px-3 pb-3 lg:px-0 lg:pb-5"
            >
              <EndCard view={view} empty={textCards.length === 0} more={more} />
            </section>
          </div>
        )}
      </div>
    </PageShell>
  );
}

const frame = "flex w-full flex-col border-[1.5px] border-ink bg-sheet";

function Meta({ interest, subtopic }: { interest: string; subtopic: string }) {
  return (
    <p className="text-sm leading-snug text-ink-soft">
      <span className="font-semibold text-ink">{interest}</span>
      {subtopic && subtopic.toLowerCase() !== interest.toLowerCase() && (
        <>
          <br />
          {subtopic}
        </>
      )}
    </p>
  );
}

/** "Go deeper": from a passive card to a real course on its subtopic. */
function DeeperLink({ subtopic, size, onDeeper }: { subtopic: string; size: "sm" | "md"; onDeeper: () => void }) {
  return (
    <Link href={deeperHref(subtopic)} onClick={onDeeper} className={clsx(buttonClasses("primary", size), "shrink-0 whitespace-nowrap")} aria-label={`Go deeper: build a course on ${subtopic}`}>
      Go deeper
      <ArrowUpRight aria-hidden="true" size={18} />
    </Link>
  );
}

function RailButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex size-12 cursor-pointer items-center justify-center rounded-control text-ink transition-colors hover:bg-raised"
    >
      {children}
    </button>
  );
}

function TopicCard({
  card,
  onLike,
  onSave,
  onShare,
  onDeeper,
}: {
  card: FeedCard;
  onLike: () => void;
  onSave: () => void;
  onShare: () => void;
  onDeeper: () => void;
}) {
  return (
    <article className={clsx(frame, "p-5 sm:p-7")}>
      <div className="flex items-start justify-between gap-3">
        <Meta interest={card.interest.name} subtopic={card.subtopic} />
      </div>

      <div className="flex min-h-0 flex-1 items-end gap-3 pt-6">
        <div className="min-w-0 flex-1 self-center">
          <h2 className="text-[1.75rem] leading-[1.08] font-bold font-stretch-[112%] sm:text-3xl">{card.title}</h2>
          <p className="mt-4 text-lg text-ink">{card.body}</p>
        </div>
        <div className="-mr-2 flex shrink-0 flex-col items-center gap-1">
          <RailButton label={card.liked ? `Unlike "${card.title}"` : `Like "${card.title}"`} pressed={card.liked} onClick={onLike}>
            <Heart
              aria-hidden="true"
              size={26}
              key={card.liked ? "on" : "off"}
              className={clsx(card.liked && "fill-current motion-safe:animate-[feed-pop_320ms_var(--ease-out)]")}
            />
          </RailButton>
          <RailButton label={card.saved ? `Remove "${card.title}" from Saved` : `Save "${card.title}"`} pressed={card.saved} onClick={onSave}>
            <Bookmark aria-hidden="true" size={24} className={clsx(card.saved && "fill-current")} />
          </RailButton>
          <RailButton label={`Share "${card.title}"`} onClick={onShare}>
            <Share2 aria-hidden="true" size={24} />
          </RailButton>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-4 border-t border-rule pt-5">
        <DeeperLink subtopic={card.subtopic} size="md" onDeeper={onDeeper} />
        <p className="text-sm text-ink-soft">Turn it into a course you can prove.</p>
      </div>
    </article>
  );
}

/** An educational Short. The player loads only near the screen, and plays muted only while on it. */
function ShortCard({ item, onShare, onDeeper }: { item: FeedShort; onShare: () => void; onDeeper: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [started, setStarted] = useState(false);
  const [calm, setCalm] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    setCalm(prefersReducedMotion());
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.6 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { videoId, title, channel } = item.short;
  // Autoplay muted while on screen, unless motion is reduced: then only after a tap.
  const playing = visible && (!calm || started);
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${started ? 0 : 1}&playsinline=1&loop=1&playlist=${videoId}&rel=0&modestbranding=1`;

  return (
    <article className={clsx(frame, "overflow-hidden")}>
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <Meta interest={item.interest.name} subtopic={item.subtopic} />
        <Badge tone="neutral" className="shrink-0">Short</Badge>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 bg-ink">
        {playing ? (
          <iframe
            src={src}
            title={`YouTube video: ${title}`}
            loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 size-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setStarted(true)}
            aria-label={`Play "${title}"`}
            className="absolute inset-0 flex cursor-pointer items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="absolute inset-0 size-full object-cover opacity-80"
            />
            <span className="relative flex size-16 items-center justify-center bg-sheet text-ink">
              <Play aria-hidden="true" size={28} className="fill-current" />
            </span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold leading-snug">{title}</p>
          <p className="truncate text-sm text-ink-soft">{channel} on YouTube</p>
        </div>
        <RailButton label={`Share "${title}"`} onClick={onShare}>
          <Share2 aria-hidden="true" size={22} />
        </RailButton>
        <DeeperLink subtopic={item.subtopic} size="sm" onDeeper={onDeeper} />
      </div>
    </article>
  );
}

function EndCard({ view, empty, more }: { view: View; empty: boolean; more: boolean }) {
  if (more) {
    return (
      <div className={clsx(frame, "items-center justify-center gap-3 text-ink-soft")}>
        <Spinner /> Loading more.
      </div>
    );
  }
  const heading = empty ? (view === "saved" ? "Nothing saved yet" : "Cards on the way") : "You're caught up";
  const text =
    view === "saved"
      ? "Tap the bookmark on a card to keep it here."
      : empty
        ? "New cards for your interests are being written. Come back in a minute, or add another interest."
        : "Fresh cards for your interests are being written. Come back soon, or go deeper on one you liked.";
  return (
    <div className={clsx(frame, "justify-center gap-4 p-7")}>
      <h2 className="text-3xl font-bold font-stretch-[112%]">{heading}</h2>
      <p className="text-lg text-ink-soft">{text}</p>
      <div className="flex flex-wrap gap-3 pt-2">
        <Link href="/" className={buttonClasses("primary", "md")}>
          Build a course
        </Link>
        <Link href="/courses" className={buttonClasses("secondary", "md")}>
          Browse courses
        </Link>
      </div>
    </div>
  );
}
