"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion, resolvedTheme, subscribeTheme } from "@/shared/ui";
import { METER_BANDS, type AudioMeter } from "../adapters/types";

/**
 * A sphere in OryxLearn's Seal inks (viridian and teal). Its edge and glow follow the real audio:
 * the question's voice while it speaks, the learner's microphone while they answer. Low
 * notes make broad swells, high notes fine ripples, and loudness swells the glow.
 *
 * Every movement comes from a real signal, except "thinking", which is a slow breath, and
 * the slow drift of light inside the sphere. Reduced motion stills both.
 */

export type OrbMood = "rest" | "thinking" | "voice" | "mic" | "proven" | "not-yet";

type OrbProps = {
  mood: OrbMood;
  /** Called each frame, so the signal can change source without re-rendering. */
  getMeter: () => AudioMeter;
  className?: string;
};

const POINTS = 120;

/** Smooth waves around the edge. Uneven phases and drift keep the shape from looking like a face. */
const WAVES = [
  { harmonic: 2, phase: 0.4, drift: 0.11, bands: [0, 3] },
  { harmonic: 3, phase: 2.1, drift: -0.17, bands: [3, 6] },
  { harmonic: 4, phase: 4.3, drift: 0.23, bands: [6, 9] },
  { harmonic: 5, phase: 1.2, drift: -0.29, bands: [9, 12] },
  { harmonic: 7, phase: 3.3, drift: 0.37, bands: [12, METER_BANDS] },
] as const;

type Rgb = [number, number, number];
/** light: the lit side. body: the middle. deep: the shaded edge. glow: the halo. */
type Palette = { light: Rgb; body: Rgb; deep: Rgb; glow: Rgb; glowStrength: number };

// From the Seal tokens: ink #0a3a37, ink-2 #37564f, tint #bfd1c7, foil teal #007a70, proven #00675e.
// The halo is kept faint: the orb reads as printed ink, not a glow.
const PALETTES: Record<OrbMood, Palette> = {
  rest: { light: [143, 176, 164], body: [55, 86, 79], deep: [10, 58, 55], glow: [55, 86, 79], glowStrength: 0.08 },
  thinking: { light: [191, 209, 199], body: [0, 122, 112], deep: [10, 58, 55], glow: [0, 122, 112], glowStrength: 0.12 },
  voice: { light: [160, 204, 194], body: [0, 103, 94], deep: [4, 34, 32], glow: [0, 103, 94], glowStrength: 0.16 },
  mic: { light: [210, 226, 218], body: [13, 75, 71], deep: [4, 34, 32], glow: [13, 75, 71], glowStrength: 0.18 },
  proven: { light: [176, 222, 208], body: [0, 103, 94], deep: [4, 34, 32], glow: [0, 103, 94], glowStrength: 0.16 },
  "not-yet": { light: [200, 210, 205], body: [55, 86, 79], deep: [10, 58, 55], glow: [55, 86, 79], glowStrength: 0.1 },
};

/** Dark theme: the same inks lifted toward bone, so the sphere reads on viridian-black paper. */
const BONE: Rgb = [214, 232, 224];
const lift = (rgb: Rgb, t: number): Rgb => rgb.map((c, i) => c + (BONE[i] - c) * t) as Rgb;
const DARK_PALETTES = Object.fromEntries(
  Object.entries(PALETTES).map(([mood, p]) => [
    mood,
    { light: lift(p.light, 0.45), body: lift(p.body, 0.3), deep: lift(p.deep, 0.18), glow: lift(p.glow, 0.4), glowStrength: p.glowStrength * 1.4 },
  ]),
) as Record<OrbMood, Palette>;

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
}

function reducedMotion(): boolean {
  return prefersReducedMotion();
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
    const strength = new Float32Array(WAVES.length);
    let level = 0;
    const start = PALETTES.rest;
    const colour = { light: [...start.light] as Rgb, body: [...start.body] as Rgb, deep: [...start.deep] as Rgb, glow: [...start.glow] as Rgb, glowStrength: start.glowStrength };

    let raf = 0;
    let lastDraw = 0;
    const still = reducedMotion();
    let dark = resolvedTheme() === "dark";
    const unsubscribeTheme = subscribeTheme(() => {
      dark = resolvedTheme() === "dark";
    });

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      // With reduced motion nothing drifts, and the size answers the sound a few times a second.
      if (still && now - lastDraw < 180) return;
      lastDraw = now;
      if (width === 0) return;

      meterRef.current().read(frame);
      // Rises fast and falls slowly, the way a level meter does, so speech reads as one swell.
      level += (frame.level - level) * (frame.level > level ? 0.4 : 0.08);
      for (let wave = 0; wave < WAVES.length; wave++) {
        const [from, to] = WAVES[wave].bands;
        let sum = 0;
        for (let band = from; band < to; band++) sum += frame.bands[band];
        const mean = sum / (to - from);
        strength[wave] += (mean * mean - strength[wave]) * 0.35;
      }

      // Colours ease over about a third of a second, so a change of state never snaps.
      const target = (dark ? DARK_PALETTES : PALETTES)[moodRef.current];
      const ease = still ? 1 : 0.08;
      for (const key of ["light", "body", "deep", "glow"] as const) {
        for (let i = 0; i < 3; i++) colour[key][i] += (target[key][i] - colour[key][i]) * ease;
      }
      colour.glowStrength += (target.glowStrength - colour.glowStrength) * ease;

      const seconds = still ? 0 : now / 1000;
      const breath = moodRef.current === "thinking" && !still ? Math.sin(seconds * 1.7) : 0;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.34 * (1 + level * 0.1 + breath * 0.025);

      context.clearRect(0, 0, width, height);

      // The halo: soft light around the sphere, brighter as the sound gets louder.
      const halo = context.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius * 1.45);
      halo.addColorStop(0, rgba(colour.glow, Math.min(0.85, colour.glowStrength * (0.55 + level * 0.9))));
      halo.addColorStop(1, rgba(colour.glow, 0));
      context.fillStyle = halo;
      context.fillRect(0, 0, width, height);

      // The edge: a circle bent by a few smooth waves, so it never spikes.
      context.beginPath();
      for (let point = 0; point <= POINTS; point++) {
        const angle = (point / POINTS) * Math.PI * 2;
        let ripple = 0;
        if (!still) {
          for (let wave = 0; wave < WAVES.length; wave++) {
            const { harmonic, phase, drift } = WAVES[wave];
            ripple += strength[wave] * Math.cos(angle * harmonic + phase + seconds * drift);
          }
        }
        const r = radius * (1 + ripple * 0.14);
        if (point === 0) context.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        else context.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      }
      context.closePath();

      // The body: lit from the upper left, shading to deep ink at the far edge.
      const body = context.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.05, cx, cy, radius * 1.15);
      body.addColorStop(0, rgba(colour.light, 1));
      body.addColorStop(0.45, rgba(colour.body, 1));
      body.addColorStop(1, rgba(colour.deep, 1));
      context.save();
      context.fillStyle = body;
      context.fill();
      context.clip();

      // Two slow lights drift inside, so the sphere looks deep rather than flat.
      context.globalCompositeOperation = "lighter";
      const drifts = [
        { colour: colour.glow, speed: 0.23, offset: 0 },
        { colour: PALETTES.thinking.body, speed: -0.17, offset: 2.4 },
      ];
      for (const light of drifts) {
        const angle = seconds * light.speed + light.offset;
        const x = cx + Math.cos(angle) * radius * 0.45;
        const y = cy + Math.sin(angle) * radius * 0.45;
        const glow = context.createRadialGradient(x, y, 0, x, y, radius * 0.8);
        glow.addColorStop(0, rgba(light.colour, 0.16 + level * 0.2));
        glow.addColorStop(1, rgba(light.colour, 0));
        context.fillStyle = glow;
        context.fillRect(cx - radius * 1.3, cy - radius * 1.3, radius * 2.6, radius * 2.6);
      }
      context.restore();

      // A thin bright rim, like light catching glass.
      context.strokeStyle = rgba(colour.light, 0.28 + level * 0.3);
      context.lineWidth = 1.25;
      context.stroke();
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      unsubscribeTheme();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
