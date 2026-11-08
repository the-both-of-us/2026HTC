"use client";

import clsx from "clsx";
import { Flame, Snowflake, Sparkles, Star } from "lucide-react";
import { useEffect, useRef } from "react";
import { WEEKLY_SPARK_GOAL, type StreakView } from "../rules";
import "./streaks.css";

type StreakNudgeProps = {
  streak: StreakView;
  /** Today's topic, while it is still open to prove. */
  topicOfTheDay: { title: string; onOpen: () => void } | null;
  className?: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * One short line in the map's header: the streak chip and today's topic. The chip opens the
 * details (this week's days, sparks and freeze), so they don't take a row of their own.
 * It never scolds: it says what one topic would do.
 */
export function StreakNudge({ streak, topicOfTheDay, className }: StreakNudgeProps) {
  const message = streak.doneToday
    ? `Streak kept today: ${streak.count} ${streak.count === 1 ? "day" : "days"}`
    : streak.count > 0
      ? `1 topic keeps your ${streak.count}-day streak`
      : "1 topic starts a streak";
  const goalPercent = Math.min(100, (streak.sparksThisWeek / WEEKLY_SPARK_GOAL) * 100);
  const freeze = streak.frozen ? "A freeze saved your streak" : streak.freezeReady ? "1 freeze ready" : "Freeze used this week";
  const details = useRef<HTMLDetailsElement>(null);

  // Close the details on a click elsewhere or Escape, like any small popover.
  useEffect(() => {
    function close(event: Event) {
      const element = details.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !element.contains(event.target as Node)) {
        element.open = false;
        if (event instanceof KeyboardEvent) element.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <div className={clsx("flex flex-wrap items-center gap-2 text-sm", className)}>
      <details ref={details} className="group relative">
        <summary
          title={`${message}. ${streak.sparksThisWeek}/${WEEKLY_SPARK_GOAL} sparks this week. ${freeze}.`}
          className={clsx(
            "inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control border px-2.5 tabular-nums transition-control [&::-webkit-details-marker]:hidden",
            streak.doneToday
              ? "border-amber/60 bg-amber/10 text-ink"
              : "border-rule-strong text-ink-soft hover:border-ink hover:text-ink",
          )}
        >
          <Flame aria-hidden="true" size={15} className={clsx("text-amber", streak.doneToday && "flame-lit")} />
          <span className="font-medium text-ink">{streak.count}</span>
          <span>{streak.count === 1 ? "day" : "days"}</span>
          <span className="sr-only">. {message}. Show this week.</span>
        </summary>

        <div className="absolute top-full left-0 z-30 mt-1.5 flex w-72 flex-col gap-2.5 rounded-control border border-rule-strong bg-sheet p-3.5 text-ink shadow-panel">
          <p className="font-medium">{message}</p>
          {/* This week at a glance: a lit dot for each day with a proof. */}
          <div className="flex items-center gap-1.5" aria-label={weekInWords(streak.week)} role="img">
            {streak.week.map((lit, index) => (
              <span key={index} className="flex flex-col items-center gap-1 text-xs text-ink-soft">
                <span className={clsx("size-3 rounded-full", lit ? "bg-amber" : "bg-rule-strong")} />
                {WEEKDAYS[index].charAt(0)}
              </span>
            ))}
          </div>
          <p className="flex items-center gap-2 text-ink-soft">
            <Sparkles aria-hidden="true" size={14} className="shrink-0 text-accent-bright" />
            <span aria-hidden="true" className="h-1.5 w-16 overflow-hidden rounded-full bg-rule-strong">
              <span className="block h-full rounded-full bg-accent-bright" style={{ width: `${goalPercent}%` }} />
            </span>
            <span className="tabular-nums">
              {streak.sparksThisWeek}/{WEEKLY_SPARK_GOAL} sparks this week
            </span>
          </p>
          <p className="flex items-center gap-2 text-ink-soft">
            <Snowflake aria-hidden="true" size={14} className="shrink-0" />
            {freeze}
          </p>
        </div>
      </details>

      {topicOfTheDay && (
        <button
          type="button"
          onClick={topicOfTheDay.onOpen}
          title={`Topic of the day: ${topicOfTheDay.title}. Double sparks.`}
          className="inline-flex min-h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-control border border-amber/60 px-2.5 text-ink transition-control hover:bg-amber/10"
        >
          <Star aria-hidden="true" size={14} className="shrink-0 text-amber" />
          <span className="text-ink-soft">Today:</span>
          <span className="max-w-[14rem] truncate font-medium">{topicOfTheDay.title}</span>
          <span className="shrink-0 text-ink-soft">2× sparks</span>
        </button>
      )}
    </div>
  );
}

function weekInWords(week: boolean[]): string {
  const days = WEEKDAYS.filter((_, index) => week[index]);
  return days.length === 0 ? "No topics proved this week yet" : `Proved something on ${days.join(", ")} this week`;
}
