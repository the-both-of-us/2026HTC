"use client";

import clsx from "clsx";
import { ArrowUpRight, Bookmark, Heart, MessageCircle, Share2, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { buttonClasses, ErrorNotice, PageShell, prefersReducedMotion, ShortPlayer, Spinner } from "@/shared/ui";
import { FEED_FORMATS, parseFormat, type FeedFormat } from "../format";
import type { FeedItem, FeedPage, FeedShort, Interest } from "../types";
import { CommentsPanel } from "./CommentsPanel";
import { InterestPicker } from "./InterestPicker";

type View = "for-you" | "saved";

const FORMAT_KEY = "oryx-feed-format";
const FORMAT_LABELS: Record<FeedFormat, string> = { both: "Both", videos: "Videos", text: "Text" };

function storedFormat(): FeedFormat {
  try {
    return parseFormat(window.localStorage.getItem(FORMAT_KEY));
  } catch {
    return "both";
  }
}

function rememberFormat(format: FeedFormat) {
  try {
    window.localStorage.setItem(FORMAT_KEY, format);
  } catch {
    // A private window may refuse storage; the choice then lasts for this visit only.
  }
}

const SOUND_KEY = "oryx-feed-sound";

/** Sound on Shorts lasts for this scroll session (the tab), not forever. */
function storedSound(): boolean {
  try {
    return window.sessionStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function rememberSound(on: boolean) {
  try {
    window.sessionStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Storage refused: sound still follows the button for this page.
  }
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const countLabel = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const titleOf = (item: FeedItem) => (item.kind === "card" ? item.title : item.short.title);
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

async function fetchPage(view: View, format: FeedFormat, exclude: string[]): Promise<FeedPage> {
  const params = new URLSearchParams();
  if (format !== "both") params.set("format", format);
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
  // Null until the remembered choice is read in the browser, so the first fetch uses it.
  const [format, setFormatState] = useState<FeedFormat | null>(null);
  const [commentsFor, setCommentsFor] = useState<FeedItem | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [more, setMore] = useState(false);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  // Sound on Shorts: off until the viewer turns it on (the button or M), then on for every
  // Short for the rest of this tab's session.
  const [sound, setSoundState] = useState(false);
  const setSound = useCallback((on: boolean) => {
    setSoundState(on);
    rememberSound(on);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  const load = useCallback(async (nextView: View, nextFormat: FeedFormat) => {
    setStatus("loading");
    try {
      const page = await fetchPage(nextView, nextFormat, []);
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
    // localStorage exists only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormatState(storedFormat());
    setSoundState(storedSound());
  }, []);

  useEffect(() => {
    // The first page comes from the server once the screen is in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (format) void load(view, format);
  }, [load, view, format]);

  const setFormat = (next: FeedFormat) => {
    rememberFormat(next);
    setFormatState(next);
  };

  const loadMore = useCallback(async () => {
    if (!more || loadingMore.current || !format) return;
    loadingMore.current = true;
    try {
      const page = await fetchPage(view, format, items.map((item) => item.id));
      const seen = new Set(items.map((item) => item.id));
      const fresh = page.items.filter((item) => !seen.has(item.id));
      setItems((before) => [...before, ...fresh.filter((item) => !before.some((old) => old.id === item.id))]);
      setMore(page.more && fresh.length > 0);
    } catch {
      // The next page will be tried again on the next swipe.
    } finally {
      loadingMore.current = false;
    }
  }, [more, items, view, format]);

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
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        setSound(!sound);
        setAnnouncement(sound ? "Sound off." : "Sound on.");
        return;
      }
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
  }, [current, sound, setSound]);

  const react = useCallback(async (card: FeedItem, reaction: "like" | "save") => {
    const field = reaction === "like" ? "liked" : "saved";
    const on = !card[field];
    const title = titleOf(card);
    // A like moves the shown count at once; a failed save moves it back.
    const flip = (value: boolean) =>
      setItems((before) =>
        before.map((item) =>
          item.id === card.id ? { ...item, [field]: value, ...(reaction === "like" && { likes: Math.max(0, item.likes + (value ? 1 : -1)) }) } : item,
        ),
      );
    flip(on);
    setAnnouncement(
      reaction === "like"
        ? on ? `Liked "${title}".` : `Removed your like from "${title}".`
        : on ? `Saved "${title}". Find it under Saved.` : `Removed "${title}" from Saved.`,
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
    const title = titleOf(item);
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

  return (
    <PageShell width="full">
      <style>{`@keyframes feed-pop{0%{transform:scale(1)}40%{transform:scale(1.3)}100%{transform:scale(1)}}`}</style>
      <div className="flex h-[calc(100dvh-3.5rem-1px)] flex-col lg:h-dvh">
        <h1 className="sr-only">For you</h1>
        {status !== "picking" && (
        <div className="mx-auto flex w-full max-w-[460px] items-center justify-between gap-2 px-4 pt-3 pb-2 lg:px-0 lg:pt-5">
          <div className="flex gap-4" role="group" aria-label="Which cards">
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
          {format && <FormatSwitch value={format} onChange={setFormat} />}
          {interests.length > 0 && (
            <button type="button" onClick={() => setStatus("picking")} className={clsx(buttonClasses("quiet", "sm"), "max-sm:size-10 max-sm:no-underline")}>
              <SlidersHorizontal aria-hidden="true" size={20} className="sm:hidden" />
              <span className="max-sm:sr-only">Edit interests</span>
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
            onCancel={interests.length > 0 ? () => (items.length > 0 ? setStatus("ready") : void load(view, format ?? "both")) : undefined}
            onDone={(saved) => {
              setInterests(saved);
              setView("for-you");
              void load("for-you", format ?? "both");
            }}
          />
        )}
        {status === "error" && (
          <div className="mx-auto w-full max-w-[460px] px-4 lg:px-0">
            <ErrorNotice message={error} onRetry={() => void load(view, format ?? "both")} />
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
                    rail={<ActionRail item={item} onReact={(reaction) => void react(item, reaction)} onComments={() => setCommentsFor(item)} onShare={() => void share(item)} />}
                    onDeeper={() => sendEvent({ itemId: item.id, event: "deeper" })}
                  />
                ) : (
                  <ShortCard
                    item={item}
                    sound={sound}
                    onSound={setSound}
                    rail={<ActionRail item={item} onReact={(reaction) => void react(item, reaction)} onComments={() => setCommentsFor(item)} onShare={() => void share(item)} />}
                    onDeeper={() => sendEvent({ itemId: item.id, event: "deeper" })}
                  />
                )}
              </section>
            ))}
            <section
              data-index={items.length}
              className="mx-auto flex h-full w-full max-w-[460px] snap-start px-3 pb-3 lg:px-0 lg:pb-5"
            >
              <EndCard view={view} format={format ?? "both"} empty={items.length === 0} more={more} />
            </section>
          </div>
        )}
        {commentsFor && (
          <CommentsPanel
            key={commentsFor.id}
            itemId={commentsFor.id}
            itemTitle={titleOf(commentsFor)}
            onClose={() => setCommentsFor(null)}
            onCount={(change) =>
              setItems((before) => before.map((item) => (item.id === commentsFor.id ? { ...item, comments: Math.max(0, item.comments + change) } : item)))
            }
          />
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

/** "Both", "Videos" or "Text": native radios, so arrow keys move the choice and screen readers hear a group. */
function FormatSwitch({ value, onChange }: { value: FeedFormat; onChange: (format: FeedFormat) => void }) {
  return (
    <fieldset className="flex shrink-0 rounded-control p-0.5 shadow-[inset_0_0_0_1.5px_var(--color-control-edge)]">
      <legend className="sr-only">Show</legend>
      {FEED_FORMATS.map((format) => (
        <label
          key={format}
          className={clsx(
            "flex min-h-9 cursor-pointer items-center rounded-control px-2.5 text-sm font-semibold has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
            value === format ? "bg-ink text-on-ink" : "text-ink-soft hover:text-ink",
          )}
        >
          <input type="radio" name="feed-format" value={format} checked={value === format} onChange={() => onChange(format)} className="sr-only" />
          {FORMAT_LABELS[format]}
        </label>
      ))}
    </fieldset>
  );
}

function RailButton({
  label,
  pressed,
  count,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  /** Shown under the icon. The label already says it for screen readers. */
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex min-h-12 w-12 cursor-pointer flex-col items-center justify-center rounded-control py-1 text-ink transition-colors hover:bg-raised"
    >
      {children}
      {count !== undefined && <span className="text-xs leading-tight font-semibold">{compact.format(count)}</span>}
    </button>
  );
}

/** Like, comment, save, share: the same four on every card and Short. */
function ActionRail({
  item,
  onReact,
  onComments,
  onShare,
}: {
  item: FeedItem;
  onReact: (reaction: "like" | "save") => void;
  onComments: () => void;
  onShare: () => void;
}) {
  const title = titleOf(item);
  const likes = countLabel(item.likes, "like", "likes");
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <RailButton label={item.liked ? `Unlike "${title}", ${likes}` : `Like "${title}", ${likes}`} pressed={item.liked} count={item.likes} onClick={() => onReact("like")}>
        <Heart
          aria-hidden="true"
          size={26}
          key={item.liked ? "on" : "off"}
          className={clsx(item.liked && "fill-current motion-safe:animate-[feed-pop_320ms_var(--ease-out)]")}
        />
      </RailButton>
      <RailButton label={`Comments on "${title}", ${countLabel(item.comments, "comment", "comments")}`} count={item.comments} onClick={onComments}>
        <MessageCircle aria-hidden="true" size={24} />
      </RailButton>
      <RailButton label={item.saved ? `Remove "${title}" from Saved` : `Save "${title}"`} pressed={item.saved} onClick={() => onReact("save")}>
        <Bookmark aria-hidden="true" size={24} className={clsx(item.saved && "fill-current")} />
      </RailButton>
      <RailButton label={`Share "${title}"`} onClick={onShare}>
        <Share2 aria-hidden="true" size={24} />
      </RailButton>
    </div>
  );
}

function TopicCard({ card, rail, onDeeper }: { card: FeedItem & { kind: "card" }; rail: ReactNode; onDeeper: () => void }) {
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
        <div className="-mr-2">{rail}</div>
      </div>

      <div className="mt-6 flex items-center gap-4 border-t border-rule pt-5">
        <DeeperLink subtopic={card.subtopic} size="md" onDeeper={onDeeper} />
        <p className="text-sm text-ink-soft">Turn it into a course you can prove.</p>
      </div>
    </article>
  );
}

/** Room under the video for the caption, and beside it for the rail. */
const CAPTION_HEIGHT = "4.5rem";
const RAIL_WIDTH = "3.25rem";

/**
 * An educational Short, edge to edge at 9:16 with the rail beside it. The player loads only near
 * the screen and plays muted while on it; sound, once turned on, stays on for the next Shorts.
 */
function ShortCard({
  item,
  rail,
  sound,
  onSound,
  onDeeper,
}: {
  item: FeedShort;
  rail: ReactNode;
  sound: boolean;
  onSound: (on: boolean) => void;
  onDeeper: () => void;
}) {
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

  const sized = {
    "--short-w": `min(calc(100cqw - ${RAIL_WIDTH}), calc((100cqh - ${CAPTION_HEIGHT}) * 9 / 16))`,
  } as CSSProperties;

  return (
    <article className="flex min-w-0 flex-1 items-center justify-center [container-type:size]" style={sized}>
      <div className="flex flex-col" style={{ width: `calc(var(--short-w) + ${RAIL_WIDTH})` }}>
        <div className="flex items-end gap-1">
          <ShortPlayer
            boxRef={box}
            videoId={videoId}
            title={title}
            // Autoplay muted while on screen, unless motion is reduced: then only after a tap.
            playing={visible && (!calm || started)}
            onStart={() => {
              setStarted(true);
              onSound(true);
            }}
            sound={sound}
            onSound={onSound}
            className="w-(--short-w) rounded-lg"
          />
          <div className="pb-1">{rail}</div>
        </div>
        <div className="flex items-center gap-3 pt-3" style={{ height: CAPTION_HEIGHT }}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-snug" title={title}>
              {title}
            </p>
            <p className="truncate text-sm text-ink-soft">
              {item.interest.name} ·{" "}
              <a
                href={`https://www.youtube.com/shorts/${videoId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:text-ink hover:underline"
                aria-label={`${channel} on YouTube (opens a new tab)`}
              >
                {channel}
              </a>
            </p>
          </div>
          <DeeperLink subtopic={item.subtopic} size="sm" onDeeper={onDeeper} />
        </div>
      </div>
    </article>
  );
}

function EndCard({ view, format, empty, more }: { view: View; format: FeedFormat; empty: boolean; more: boolean }) {
  if (more) {
    return (
      <div className={clsx(frame, "items-center justify-center gap-3 text-ink-soft")}>
        <Spinner /> Loading more.
      </div>
    );
  }
  const videos = format === "videos";
  const heading = empty ? (view === "saved" ? "Nothing saved yet" : videos ? "Videos on the way" : "Cards on the way") : "You're caught up";
  const text =
    view === "saved"
      ? videos
        ? "Tap the bookmark on a video to keep it here."
        : "Tap the bookmark on a card to keep it here."
      : videos
        ? "More videos for your interests are being found. Come back soon, or switch to Both."
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
