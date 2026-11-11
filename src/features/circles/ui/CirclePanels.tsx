"use client";

import clsx from "clsx";
import { Flag, HandHeart, UserPlus } from "lucide-react";
import { circleRace } from "@/features/streaks/client";
import { Button, PretestBadge } from "@/shared/ui";
import type { CircleActivity, CircleView } from "../circles";

/** Initials in a round token, the same as on the map's cards. */
export function Initials({ name, you = false, size = 32 }: { name: string; you?: boolean; size?: number }) {
  const letters = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? "").toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold",
        you ? "bg-ink text-on-ink" : "bg-proven text-on-proven",
      )}
    >
      {letters}
    </span>
  );
}

/**
 * The race: everyone in the circle, most topics proved first, each with a bar to the finish.
 * Ties go to whoever got there first.
 */
export function CircleRaceBoard({ view, now, onInvite }: { view: CircleView; now: number; onInvite: () => void }) {
  const total = view.map.nodes.length;
  const race = circleRace(view, new Date(now));
  const lastProof = (name: string) => view.feed.find((item) => item.name === name)?.at ?? "";
  const rows = view.members
    .map((member, joinOrder) => ({ ...member, joinOrder }))
    .sort(
      (a, b) =>
        b.proved - a.proved ||
        (a.proved > 0 ? lastProof(a.name).localeCompare(lastProof(b.name)) : 0) ||
        a.joinOrder - b.joinOrder,
    );
  const solo = view.members.length === 1;

  return (
    <section aria-labelledby="circle-race" className="rounded-sheet border border-rule-strong bg-sheet p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="circle-race" className="text-lg font-medium">
          The race
        </h2>
        <p className="flex items-center gap-1.5 text-sm text-ink-soft">
          <Flag aria-hidden="true" size={14} className="shrink-0" />
          {race.first
            ? `${race.first} finished first`
            : race.finished.length > 0
              ? `${race.finished.join(" and ")} finished`
              : `First to all ${total} wins`}
        </p>
      </div>

      <ol className="flex flex-col gap-3">
        {rows.map((member, index) => {
          const share = total > 0 ? Math.round((member.proved / total) * 100) : 0;
          return (
            <li key={`${member.name}-${member.joinOrder}`} className="grid grid-cols-[1.25rem_auto_minmax(0,1fr)] items-center gap-x-2.5">
              <span className="text-sm text-ink-soft tabular-nums">{index + 1}</span>
              <Initials name={member.name} you={member.isYou} />
              <div className="min-w-0">
                <p className="flex items-baseline justify-between gap-2">
                  <span className={clsx("min-w-0 truncate", member.isYou && "font-medium")}>
                    {member.name}
                    {member.isYou && <span className="font-normal text-ink-soft"> (you)</span>}
                  </span>
                  <span className="shrink-0 text-sm text-ink-soft tabular-nums">
                    {member.proved} of {total}
                  </span>
                </p>
                <div
                  role="progressbar"
                  aria-label={`${member.name}: ${member.proved} of ${total} topics proved`}
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={member.proved}
                  className="mt-1 h-2 overflow-hidden bg-raised"
                >
                  <div
                    className={clsx("progress-fill h-full", member.isYou ? "bg-ink" : "bg-proven")}
                    style={{ width: `${share}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {solo && view.members[0]?.isYou && (
        <div className="mt-4 border-t border-rule pt-3">
          <p className="text-ink-soft">
            It&apos;s just you so far. Invite a classmate or a friend: they get their own copy, and you&apos;ll see each
            other&apos;s progress here.
          </p>
          <Button variant="secondary" size="sm" onClick={onInvite} className="mt-3">
            <UserPlus aria-hidden="true" size={16} />
            Invite someone
          </Button>
        </div>
      )}
    </section>
  );
}

/** "just now", "4 min ago", "2 h ago", then "3 days ago". */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The newest proofs, each with one-tap cheers for members. */
export function CircleFeed({
  feed,
  now,
  canCheer,
  stale,
  onCheer,
  className,
}: {
  feed: CircleActivity[];
  now: number;
  /** Only members cheer. */
  canCheer: boolean;
  stale: boolean;
  onCheer: (item: CircleActivity) => void;
  className?: string;
}) {
  return (
    <section aria-labelledby="circle-feed" className={clsx("flex flex-col rounded-sheet border border-rule-strong bg-sheet", className)}>
      <h2 id="circle-feed" className="px-4 pt-4 pb-2 text-lg font-medium">
        Live activity
      </h2>
      {stale && <p className="px-4 pb-2 text-sm text-ink-soft">Reconnecting. What you see may be a few seconds old.</p>}
      {feed.length === 0 ? (
        <p className="px-4 pb-4 text-ink-soft">
          No proofs yet. When someone teaches a topic back and passes, it lands here within seconds.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {feed.map((item) => (
            <li key={item.id} className="flex items-start gap-3 border-t border-rule py-2.5 first:border-t-0">
              <Initials name={item.name} you={item.isYou} size={30} />
              <div className="min-w-0 flex-1">
                <p className="leading-snug">
                  <span className="font-medium">{item.isYou ? "You" : item.name}</span>{" "}
                  {item.pretest ? "passed a pre-test question on" : "proved"}{" "}
                  <span className="font-medium">{item.nodeTitle}</span>
                </p>
                {item.pretest && <PretestBadge className="mt-1" />}
                <p className="mt-0.5 flex items-center justify-between gap-2 text-sm text-ink-soft">
                  <time dateTime={item.at}>{timeAgo(item.at, now)}</time>
                  <CheerButton item={item} canCheer={canCheer} onCheer={onCheer} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CheerButton({
  item,
  canCheer,
  onCheer,
}: {
  item: CircleActivity;
  canCheer: boolean;
  onCheer: (item: CircleActivity) => void;
}) {
  const count =
    item.cheers > 0 ? (
      <span className="tabular-nums" aria-label={`${item.cheers} ${item.cheers === 1 ? "cheer" : "cheers"}`}>
        {item.cheers}
      </span>
    ) : null;
  // Your own proof, or a visitor's view: the count only.
  if (item.isYou || !canCheer) {
    return item.cheers > 0 ? (
      <span className="inline-flex items-center gap-1">
        <HandHeart aria-hidden="true" size={15} />
        {item.cheers} {item.cheers === 1 ? "cheer" : "cheers"}
      </span>
    ) : null;
  }
  return (
    <span className="inline-flex items-center gap-2">
      {count}
      <button
        type="button"
        aria-pressed={item.youCheered}
        onClick={() => !item.youCheered && onCheer(item)}
        className={clsx(
          "-my-1 inline-flex min-h-8 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium transition-control",
          item.youCheered
            ? "bg-ink text-on-ink"
            : "cursor-pointer text-ink shadow-[inset_0_0_0_1.5px_var(--color-rule-strong)] hover:shadow-[inset_0_0_0_1.5px_var(--color-ink)]",
        )}
      >
        <HandHeart aria-hidden="true" size={15} />
        {item.youCheered ? "Cheered" : "Cheer"}
        <span className="sr-only">
          {" "}
          {item.name} for {item.nodeTitle}
        </span>
      </button>
    </span>
  );
}
