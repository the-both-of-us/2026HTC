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
    <section aria-labelledby="streak-heading" className="flex flex-col gap-3 rounded-sheet border border-rule-strong bg-sheet/90 p-5 shadow-panel">
      <h2 id="streak-heading" className="flex items-center gap-2 text-base font-semibold text-ink-soft">
        <Flame aria-hidden="true" size={18} />
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
      <p className="text-3xl font-medium">Day streak: {streak.count}</p>
      <p className="text-ink-soft">{streakMessage(streak)}</p>
      <ol aria-label="The last 7 days" className="flex gap-2">
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
