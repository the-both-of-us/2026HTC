"use client";

import { Flame, Sparkles, Trophy, Volume2, VolumeX, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProofReward as Reward } from "../rules";
import { isSoundOn, playChime, setSoundOn } from "./sound";
import "./streaks.css";

/** The small payoff on the unlock moment: combo, streak, sparks. It chimes once, if sound is on. */
export function ProofReward({ reward }: { reward: Reward }) {
  useEffect(() => {
    playChime(reward.combo || 1);
  }, [reward]);

  const streakText = reward.milestone
    ? `${reward.streak} days in a row. That's a milestone!`
    : `${reward.streak}-day streak${reward.streak > 1 ? ", kept for today" : " started"}`;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
      {reward.combo >= 2 && (
        <span className="combo-pop inline-flex items-center gap-1 rounded-control border border-amber/60 bg-amber/15 px-2.5 py-0.5 text-amber">
          <Zap aria-hidden="true" size={14} />
          Combo x{reward.combo}
        </span>
      )}
      {reward.streakGrew && (
        <span className="inline-flex items-center gap-1 rounded-control border border-amber/45 bg-amber/10 px-2.5 py-0.5 text-ink">
          <Flame aria-hidden="true" size={14} className="text-amber" />
          {streakText}
        </span>
      )}
      {reward.sparks > 0 && (
        <span className="inline-flex items-center gap-1 rounded-control border border-rule-strong bg-raised px-2.5 py-0.5 text-ink">
          <Sparkles aria-hidden="true" size={14} className="text-accent-bright" />+{reward.sparks} {reward.sparks === 1 ? "spark" : "sparks"}
          {reward.topicOfTheDay && ", topic of the day"}
        </span>
      )}
      {reward.goalReached && (
        <span className="combo-pop inline-flex items-center gap-1 rounded-control border border-accent/50 bg-accent/15 px-2.5 py-0.5 text-ink">
          <Trophy aria-hidden="true" size={14} className="text-accent-bright" />
          Weekly goal reached
        </span>
      )}
      <SoundToggle />
    </div>
  );
}

/** Mute or unmute the chime. The choice is remembered in this browser. */
export function SoundToggle() {
  // Only rendered after a proof in the browser, so localStorage is safe to read here.
  const [on, setOn] = useState(isSoundOn);

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        setSoundOn(!on);
        setOn(!on);
      }}
      className="ml-auto inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-control px-2 text-ink-soft transition-control hover:bg-raised hover:text-ink"
    >
      {on ? <Volume2 aria-hidden="true" size={16} /> : <VolumeX aria-hidden="true" size={16} />}
      Sound
    </button>
  );
}
