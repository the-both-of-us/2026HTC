"use client";

import { useEffect, useMemo, useState } from "react";
import { spokenWordCount, splitWords } from "../captions";

type SpokenQuestionProps = {
  id: string;
  question: string;
  /** While true, the words light up in time with the voice. Otherwise all are solid. */
  following: boolean;
  getPosition: () => { seconds: number; duration: number | null };
  size: "large" | "small";
};

/**
 * The question is always on screen as text, so sound is never the only way to get it.
 * Words brighten as they're spoken, which keeps the layout perfectly still.
 */
export function SpokenQuestion({ id, question, following, getPosition, size }: SpokenQuestionProps) {
  const words = useMemo(() => splitWords(question), [question]);
  const [spoken, setSpoken] = useState(0);

  useEffect(() => {
    if (!following) return;
    let raf = 0;
    const tick = () => {
      const { seconds, duration } = getPosition();
      setSpoken(spokenWordCount(words, seconds, duration));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [following, getPosition, words]);

  const className =
    size === "large"
      ? "text-pretty text-2xl font-medium tracking-[-0.01em] @2xl:text-[1.75rem] @2xl:leading-[1.28]"
      : "text-pretty text-base text-ink-soft";

  return (
    <h3 id={id} className={className}>
      {following
        ? words.map((word, index) => (
            <span
              key={index}
              className={index < spoken ? "text-ink motion-safe:transition-colors motion-safe:duration-200" : "text-locked"}
            >
              {word}
              {index < words.length - 1 ? " " : ""}
            </span>
          ))
        : question}
    </h3>
  );
}
