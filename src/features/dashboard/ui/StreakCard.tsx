"use client";

import clsx from "clsx";
import { Flame } from "lucide-react";
import { useSyncExternalStore } from "react";
import { computeStreak, streakMessage } from "../streak";

const subscribe = () => () => {};

/** Days are the viewer's own, so the streak is counted in the browser, with its timezone. */
export function StreakCard({ activity }: { activity: string[] }) {
  // False while rendering on the server and hydrating, so the two always match.
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <section aria-labelledby="streak-heading" className="flex flex-col gap-2 rounded-xl border border-rule-strong bg-sheet p-5 shadow-sm">
      <h2 id="streak-heading" className="flex items-center gap-2.5 text-sm font-semibold text-ink-soft">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-proven/12 text-proven">
          <Flame size={16} />
        </span>
        Streak
      </h2>
      {inBrowser ? <StreakBody activity={activity} /> : <p className="text-ink-soft">Counting your days.</p>}
    </section>
  );
}

function StreakBody({ activity }: { activity: string[] }) {
  const streak = computeStreak(activity, new Date(), (date) => -date.getTimezoneOffset());
  return (
    <>
      <p className="mt-1 text-4xl font-medium tabular-nums">
        {streak.count} <span className="text-lg font-normal text-ink-soft">{streak.count === 1 ? "day" : "days"}</span>
      </p>
      <p className="text-ink-soft">{streakMessage(streak)}</p>
      <ol aria-label="The last 7 days" className="mt-1 flex gap-2">
        {streak.week.map((day) => {
          const date = new Date(`${day.dayKey}T12:00:00Z`);
          const short = date.toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" });
          const long = day.isToday ? "Today" : date.toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });
          return (
            <li key={day.dayKey} className="flex flex-col items-center gap-1">
              <span
                aria-hidden="true"
                className={clsx(
                  "size-5 rounded-full border-2",
                  day.active ? "border-proven bg-proven" : "border-control-edge bg-transparent",
                  day.isToday && "ring-2 ring-accent ring-offset-2 ring-offset-sheet",
                )}
              />
              <span aria-hidden="true" className="text-sm text-ink-soft">
                {short}
              </span>
              <span className="sr-only">
                {long}: {day.active ? "active" : "no activity"}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
