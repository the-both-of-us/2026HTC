"use client";

import clsx from "clsx";
import { Flag, Trophy } from "lucide-react";
import type { CircleView } from "@/features/circles";
import { circleRace } from "../race";

/** On the circle page: this week's leaderboard, and who proved the whole course first. */
export function CircleRace({ view, now }: { view: CircleView; now: number }) {
  const race = circleRace(view, new Date(now));
  const total = view.map.nodes.length;
  const leader = race.rows[0];

  return (
    <section aria-labelledby="circle-race" className="rounded-sheet border border-amber/45 bg-sheet/80 p-4">
      <h2 id="circle-race" className="mb-3 flex items-center gap-2 text-lg font-medium">
        <Trophy aria-hidden="true" size={18} className="text-amber" /> This week&apos;s race
      </h2>

      <p className="mb-3 flex items-start gap-2 rounded-control border border-amber/40 bg-amber/10 px-3 py-2">
        <Flag aria-hidden="true" size={16} className="mt-1 shrink-0 text-amber" />
        <span>
          {race.first
            ? `${race.first} finished the course first!${race.finished.length > 1 ? ` ${race.finished.length - 1} more since.` : ""}`
            : race.finished.length > 0
              ? `${race.finished.join(" and ")} proved every topic.`
              : `First to prove all ${total} topics wins the banner.`}
        </span>
      </p>

      {leader && leader.thisWeek > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {race.rows.map((row, index) => (
            <li
              key={index}
              className={clsx("flex items-center justify-between gap-3", row.isYou && "font-medium")}
            >
              <span className="min-w-0 truncate">
                <span className="inline-block w-6 text-ink-soft tabular-nums">{index + 1}.</span>
                {row.name}
                {row.isYou && <span className="font-normal text-ink-soft"> (you)</span>}
              </span>
              <span className="shrink-0 text-sm text-ink-soft tabular-nums">
                {row.thisWeek} {row.thisWeek === 1 ? "topic" : "topics"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-ink-soft">Nobody has proved a topic this week yet. The first one takes the lead.</p>
      )}
      {race.partial && <p className="mt-2 text-sm text-ink-soft">Counting the newest {view.feed.length} proofs.</p>}
    </section>
  );
}
