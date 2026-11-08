"use client";

import clsx from "clsx";
import { Flame, Snowflake, Sparkles, Star } from "lucide-react";
import { WEEKLY_SPARK_GOAL, type StreakView } from "../rules";
import "./streaks.css";

type StreakNudgeProps = {
  streak: StreakView;
  /** Today's topic, while it is still open to prove. */
  topicOfTheDay: { title: string; onOpen: () => void } | null;
  className?: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A gentle line under the map's title. It never scolds: it says what one topic would do. */
export function StreakNudge({ streak, topicOfTheDay, className }: StreakNudgeProps) {
  const message = streak.doneToday
    ? `Streak kept today: ${streak.count} ${streak.count === 1 ? "day" : "days"}`
    : streak.count > 0
      ? `1 topic keeps your ${streak.count}-day streak`
      : "1 topic starts a streak";
  const goalPercent = Math.min(100, (streak.sparksThisWeek / WEEKLY_SPARK_GOAL) * 100);

  return (
    <div className={clsx("flex flex-wrap items-center gap-2 text-sm", className)}>
      <span
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-control border px-2.5 py-0.5",
          streak.doneToday ? "border-amber/50 bg-amber/10 text-ink" : "border-rule-strong bg-raised text-ink-soft",
        )}
      >
        <Flame aria-hidden="true" size={14} className={clsx("text-amber", streak.doneToday && "flame-lit")} />
        {message}
      </span>

      {/* This week at a glance: a lit dot for each day with a proof. */}
      <span className="inline-flex items-center gap-1" aria-label={weekInWords(streak.week)} role="img">
        {streak.week.map((lit, index) => (
          <span
            key={index}
            title={WEEKDAYS[index]}
            className={clsx("size-2.5 rounded-full", lit ? "bg-amber" : "bg-rule-strong")}
          />
        ))}
      </span>

      <span className="inline-flex items-center gap-1.5 text-ink-soft" title="Sparks this week">
        <Sparkles aria-hidden="true" size={14} className="text-accent-bright" />
        <span aria-hidden="true" className="h-1.5 w-14 overflow-hidden rounded-full bg-rule-strong">
          <span className="block h-full rounded-full bg-accent-bright" style={{ width: `${goalPercent}%` }} />
        </span>
        <span className="tabular-nums">
          {streak.sparksThisWeek}/{WEEKLY_SPARK_GOAL} sparks this week
        </span>
      </span>

      <span className="inline-flex items-center gap-1 text-ink-soft">
        <Snowflake aria-hidden="true" size={13} />
        {streak.frozen ? "A freeze saved your streak" : streak.freezeReady ? "1 freeze ready" : "Freeze used this week"}
      </span>

      {topicOfTheDay && (
        <button
          type="button"
          onClick={topicOfTheDay.onOpen}
          className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-control border border-amber/50 px-2.5 py-0.5 text-ink transition-control hover:bg-amber/10"
        >
          <Star aria-hidden="true" size={14} className="text-amber" />
          Topic of the day: {topicOfTheDay.title}
          <span className="text-ink-soft">double sparks</span>
        </button>
      )}
    </div>
  );
}

function weekInWords(week: boolean[]): string {
  const days = WEEKDAYS.filter((_, index) => week[index]);
  return days.length === 0 ? "No topics proved this week yet" : `Proved something on ${days.join(", ")} this week`;
}
