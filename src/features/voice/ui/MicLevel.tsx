"use client";

import { useEffect, useRef } from "react";
import { METER_BANDS, type AudioMeter } from "../adapters/types";

const BARS = 5;

/**
 * Five small bars that follow the microphone, so the learner can see they are being heard.
 * They read the real AnalyserNode through getMeter. With reduced motion they update a few
 * times a second instead of every frame.
 */
export function MicLevel({ getMeter }: { getMeter: () => AudioMeter }) {
  const barsRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef(getMeter);

  useEffect(() => {
    meterRef.current = getMeter;
  });

  useEffect(() => {
    const bars = Array.from(barsRef.current?.children ?? []) as HTMLElement[];
    const frame = { level: 0, bands: new Float32Array(METER_BANDS) };
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const perBar = Math.floor(METER_BANDS / BARS);
    let raf = 0;
    let last = 0;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (still && now - last < 200) return;
      last = now;
      meterRef.current().read(frame);
      bars.forEach((bar, index) => {
        let sum = 0;
        for (let band = index * perBar; band < (index + 1) * perBar; band++) sum += frame.bands[band];
        const height = Math.min(1, 0.18 + (sum / perBar) * 1.4 + frame.level * 0.5);
        bar.style.transform = `scaleY(${height.toFixed(3)})`;
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <span ref={barsRef} aria-hidden="true" className="flex h-5 items-center gap-[3px]">
      {Array.from({ length: BARS }, (_, index) => (
        <span
          key={index}
          className="h-full w-[3px] origin-center scale-y-[0.18] rounded-full bg-gradient-to-t from-accent to-violet motion-safe:transition-transform motion-safe:duration-75"
        />
      ))}
    </span>
  );
}
