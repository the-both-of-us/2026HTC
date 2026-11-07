"use client";

import { useEffect, useRef } from "react";
import { METER_BANDS, type AudioMeter } from "../adapters/types";

/**
 * The orb is a contour map: the same lines the skill map uses for terrain. Sound enters
 * at the centre and travels outward ring by ring, so a voice raises and lowers the ground.
 *
 * Every movement comes from a real signal, except "thinking", which is a slow breath.
 */

export type OrbMood = "rest" | "thinking" | "voice" | "mic" | "proven" | "not-yet";

type OrbProps = {
  mood: OrbMood;
  /** Called each frame, so the signal can change source without re-rendering. */
  getMeter: () => AudioMeter;
  className?: string;
};

const RINGS = 8;
const POINTS = 96;
const HISTORY = 64;
/** Frames of delay between one ring and the next. */
const RING_DELAY = 5;

/** Slow drift and uneven phases keep the shape from settling into anything that looks like a face. */
const WAVES = [
  { harmonic: 2, phase: 0.4, drift: 0.11 },
  { harmonic: 3, phase: 2.1, drift: -0.17 },
  { harmonic: 4, phase: 4.3, drift: 0.23 },
  { harmonic: 5, phase: 1.2, drift: -0.29 },
  { harmonic: 7, phase: 3.3, drift: 0.37 },
] as const;

/** Which bands of the spectrum drive each wave: low notes make broad swells, high ones fine ripples. */
const WAVE_BANDS = [
  [0, 3],
  [3, 6],
  [6, 9],
  [9, 12],
  [12, METER_BANDS],
] as const;

type Palette = { line: readonly number[]; core: readonly number[]; coreOpacity: number };

const PALETTES: Record<OrbMood, Palette> = {
  rest: { line: [91, 104, 133], core: [91, 104, 133], coreOpacity: 0.28 },
  thinking: { line: [107, 165, 224], core: [75, 143, 212], coreOpacity: 0.45 },
  voice: { line: [107, 165, 224], core: [75, 143, 212], coreOpacity: 1 },
  mic: { line: [140, 192, 245], core: [232, 236, 244], coreOpacity: 1 },
  proven: { line: [91, 170, 122], core: [91, 170, 122], coreOpacity: 1 },
  "not-yet": { line: [196, 144, 58], core: [196, 144, 58], coreOpacity: 0.85 },
};

/** A fixed, gentle terrain for each ring, so the lines look surveyed rather than geometric. */
function terrain(angle: number, ring: number): number {
  const r = ring + 1;
  return (
    Math.sin(angle * 2 + r * 0.9) * 0.5 +
    Math.sin(angle * 3 - r * 0.55 + 1.2) * 0.32 +
    Math.sin(angle * 5 + r * 0.31 + 2.4) * 0.18
  );
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Orb({ mood, getMeter, className }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef(mood);
  const meterRef = useRef(getMeter);

  useEffect(() => {
    moodRef.current = mood;
    meterRef.current = getMeter;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      canvas.width = Math.round(box.width * scale);
      canvas.height = Math.round(box.height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = { level: 0, bands: new Float32Array(METER_BANDS) };
    // A ring buffer of recent spectra: ring n draws what the centre heard n * RING_DELAY frames ago.
    const history = Array.from({ length: HISTORY }, () => new Float32Array(METER_BANDS));
    const levels = new Float32Array(HISTORY);
    const levelFor = new Float32Array(RINGS);
    const waveStrength = new Float32Array(WAVES.length);
    let head = 0;
    let smoothLevel = 0;
    const colour = { line: [...PALETTES.rest.line], core: [...PALETTES.rest.core], coreOpacity: PALETTES.rest.coreOpacity };

    let raf = 0;
    let lastDraw = 0;
    const still = reducedMotion();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // With reduced motion the rings stay still, and only the core answers, a few times a second.
      if (still && now - lastDraw < 180) return;
      lastDraw = now;
      if (width === 0) return;

      const currentMood = moodRef.current;
      meterRef.current().read(frame);
      head = (head + 1) % HISTORY;
      history[head].set(frame.bands);
      levels[head] = frame.level;
      smoothLevel += (frame.level - smoothLevel) * (frame.level > smoothLevel ? 0.45 : 0.1);

      // Colours ease over about a third of a second, so state changes never snap.
      const target = PALETTES[currentMood];
      const ease = still ? 1 : 0.09;
      for (let i = 0; i < 3; i++) {
        colour.line[i] += (target.line[i] - colour.line[i]) * ease;
        colour.core[i] += (target.core[i] - colour.core[i]) * ease;
      }
      colour.coreOpacity += (target.coreOpacity - colour.coreOpacity) * ease;

      const seconds = now / 1000;
      const breath = currentMood === "thinking" && !still ? 0.5 + 0.5 * Math.sin(seconds * 1.7) : 0;
      const size = Math.min(width, height);
      const radius = size * 0.47;
      const cx = width / 2;
      const cy = height / 2;
      const inner = radius * 0.24;

      context.clearRect(0, 0, width, height);

      for (let ring = RINGS - 1; ring >= 0; ring--) {
        const position = (ring + 1) / RINGS;
        const base = inner + (radius - inner) * position * 0.86;
        const past = (head - ring * RING_DELAY + HISTORY * 4) % HISTORY;
        const spectrum = history[past];
        levelFor[ring] = levels[past];

        // Sound loses strength as it travels out.
        const carry = (1 - position * 0.5) * radius * 0.17;
        const relief = radius * 0.028 * (0.55 + position * 0.75);
        // The breath moves outward as a slow wave.
        const swell = breath ? Math.sin(seconds * 1.7 - position * 2.6) * radius * 0.012 : 0;

        // The spectrum sets the strength of a few smooth waves around the ring. Using waves,
        // rather than plotting the spectrum, keeps every line soft, with no spikes or seam.
        for (let wave = 0; wave < WAVES.length; wave++) {
          const [from, to] = WAVE_BANDS[wave];
          let sum = 0;
          for (let band = from; band < to; band++) sum += spectrum[band];
          const mean = sum / (to - from);
          waveStrength[wave] = mean * mean;
        }
        const lift = still ? 0 : levels[past] * carry * 0.45;

        context.beginPath();
        for (let point = 0; point <= POINTS; point++) {
          const angle = (point / POINTS) * Math.PI * 2;
          let ripple = 0;
          if (!still) {
            for (let wave = 0; wave < WAVES.length; wave++) {
              const { harmonic, phase, drift } = WAVES[wave];
              ripple += waveStrength[wave] * Math.cos(angle * harmonic + phase + seconds * drift);
            }
          }
          const r = base + terrain(angle, ring) * relief + lift + ripple * carry + swell;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (point === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.closePath();

        const energy = Math.min(1, levelFor[ring] * 1.6);
        const fade = 1 - position * 0.72;
        const alpha = 0.3 + fade * 0.5 + energy * 0.2 + breath * 0.1 * fade;
        context.strokeStyle = `rgba(${colour.line[0] | 0},${colour.line[1] | 0},${colour.line[2] | 0},${Math.min(1, alpha)})`;
        context.lineWidth = 1 + (1 - position) * 0.6;
        context.stroke();
      }

      // The core: the survey station at the middle of the contours.
      const coreRadius = inner * (0.82 + smoothLevel * 0.42 + breath * 0.07);
      context.beginPath();
      for (let point = 0; point <= POINTS; point++) {
        const angle = (point / POINTS) * Math.PI * 2;
        const r = coreRadius + terrain(angle, -1) * radius * 0.004;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (point === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fillStyle = `rgba(${colour.core[0] | 0},${colour.core[1] | 0},${colour.core[2] | 0},${colour.coreOpacity})`;
      context.fill();
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
