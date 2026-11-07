import { sha256Hex } from "./sha256";

/**
 * Guilloche seals, ported from the Seal prototype. Pure math: a fingerprint goes in, SVG path
 * data comes out, the same every time. No DOM, so it runs on the server, in the browser and in tests.
 *
 * A seal is drawn in a 200 by 200 box: a scalloped solid band with a woven mesh across it,
 * nested petals inside the band, a small woven ring round the centre, and a few plain rings.
 */

const TAU = Math.PI * 2;

/** How much to draw. More strands and petal layers at larger sizes; `res` thins the points per line. */
export const SEAL_DETAIL = {
  node: { n: 4, lay: 3, pm: 1, hair: 0.7, rim: 0.9, res: 0.45 },
  mid: { n: 7, lay: 5, pm: 1.4, hair: 0.65, rim: 1, res: 0.6 },
  big: { n: 11, lay: 8, pm: 1.9, hair: 0.7, rim: 1.1, res: 0.85 },
  hero: { n: 17, lay: 14, pm: 2.9, hair: 0.75, rim: 1.25, res: 0.9 },
} as const;
export type SealDetail = keyof typeof SEAL_DETAIL;

/**
 * struck: solid ink band, a paper-white mesh and foil petals. For proven skills only.
 * ink:    the same drawing in ink alone, where nothing is proven yet.
 * white:  light lines for a seal on a dark ink band.
 */
export type SealKind = "struck" | "ink" | "white";

/** Which token a part is painted in. The component turns these into CSS variables. */
export type SealPaint = "ink" | "paper" | "foil" | "on-ink";

export type SealLine = { d: string; paint: SealPaint; width: number };
export type SealDrawing = {
  /** The solid scalloped band, drawn with fill-rule evenodd. */
  band: { d: string; paint: SealPaint };
  lines: SealLine[];
  /** Radius of the microtext circle, when the seal carries microtext. */
  microRadius: number | null;
};

export type SealOptions = {
  detail?: SealDetail;
  kind?: SealKind;
  /** Radius of the plain centre, in the 200 box. 27 leaves room for a tick; 38 for a figure. */
  center?: number;
  /** Leaves an outer ring free for microtext, as on the evidence page. */
  micro?: boolean;
};

const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
const pol = (r: number, t: number) => f1(100 + r * Math.cos(t)) + " " + f1(100 + r * Math.sin(t));

/** A plain circle as path data. */
export const ring = (r: number) => `M${f1(100 - r)} 100a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

/** Reads the hash a byte at a time, so every byte changes the drawing. */
function hashReader(hex: string) {
  let i = 0;
  return (lo: number, hi: number) => {
    const v = parseInt(hex.substr(i % hex.length, 2), 16);
    i += 2;
    return lo + Math.floor((v / 256) * (hi - lo + 1));
  };
}

/** Woven band: n phase-shifted strands swing between an inner ring and a scalloped outer edge. */
function mesh(
  { ri, ro, p, n, cusps = 0, cut = 0, rot = 0 }: { ri: number; ro: number; p: number; n: number; cusps?: number; cut?: number; rot?: number },
  res: number,
) {
  let d = "";
  const steps = Math.round(Math.max(p * 14, 120) * res);
  for (let k = 0; k < n; k++) {
    const ph = (TAU * k) / n;
    for (let i = 0; i <= steps; i++) {
      const t = (TAU * i) / steps;
      const out = ro - (cusps ? cut * (1 - Math.abs(Math.sin((cusps * t) / 2 + rot))) : 0);
      const r = ri + (out - ri) * (0.5 + 0.5 * Math.sin(p * t + ph));
      d += (i ? "L" : "M") + pol(r, t);
    }
    d += "Z";
  }
  return d;
}

/** Nested petals: engraved parallel lines that meet at sharp cusps. */
function petals(
  { ri, ro, o, layers, rot = 0, min = 0.3, e = 0.75 }: { ri: number; ro: number; o: number; layers: number; rot?: number; min?: number; e?: number },
  res: number,
) {
  let d = "";
  const steps = Math.round(o * 30 * res);
  for (let k = 0; k < layers; k++) {
    const s = layers === 1 ? 1 : min + ((1 - min) * k) / (layers - 1);
    for (let i = 0; i <= steps; i++) {
      const t = (TAU * i) / steps;
      const r = ri + (ro - ri) * s * Math.pow(Math.abs(Math.sin((o * t) / 2 + rot)), e);
      d += (i ? "L" : "M") + pol(r, t);
    }
    d += "Z";
  }
  return d;
}

function scallop(ro: number, cusps: number, cut: number, rot: number) {
  let d = "";
  const steps = cusps * 16;
  for (let i = 0; i <= steps; i++) {
    const t = (TAU * i) / steps;
    const r = ro - cut * (1 - Math.abs(Math.sin((cusps * t) / 2 + rot)));
    d += (i ? "L" : "M") + pol(r, t);
  }
  return d + "Z";
}

/** A fingerprint as hex: a hex digest (32 characters or more) is used as it is, anything else is hashed. */
export function toSealHex(fingerprint: string): string {
  return /^[0-9a-f]{32,}$/i.test(fingerprint) ? fingerprint.toLowerCase() : sha256Hex(fingerprint);
}

const MAX_CACHED = 200;
const cache = new Map<string, SealDrawing>();

/** The seal for a fingerprint. Memoised: the same fingerprint and options give the same object. */
export function sealDrawing(fingerprint: string, options: SealOptions = {}): SealDrawing {
  const { detail = "node", kind = "struck", center = 27, micro = false } = options;
  const hex = toSealHex(fingerprint);
  const key = [hex, detail, kind, center, micro].join("|");
  const hit = cache.get(key);
  if (hit) return hit;

  const q = SEAL_DETAIL[detail];
  const rd = hashReader(hex);
  // The read order is part of the design: changing it changes every seal.
  const o = rd(6, 13);
  const cusps = rd(10, 15) * 2;
  const p = Math.round(rd(10, 17) * q.pm);
  const rot = rd(0, 99) / 30;
  const twist = rd(0, 1);
  const cut = rd(40, 80) / 10;
  const o2 = o * 2 + twist;
  const ro = micro ? 87 : 96;
  const band = center > 34 ? 70 : 66;
  const e = rd(55, 95) / 100;

  const weave = mesh({ ri: band, ro, p, n: q.n, cusps, cut, rot }, q.res);
  const petalLines =
    petals({ ri: center + 7, ro: band - 2, o, layers: q.lay, rot, e }, q.res) +
    petals({ ri: center + 7, ro: band - 2, o, layers: q.lay, rot: rot + Math.PI / o, e }, q.res);
  const inner = mesh({ ri: center, ro: center + 6, p: o2, n: Math.max(2, q.n >> 1) }, q.res);
  const solid = scallop(ro, cusps, cut, rot) + ring(band);

  let drawing: SealDrawing;
  if (kind === "white") {
    drawing = {
      band: { d: solid, paint: "on-ink" },
      lines: [
        { d: weave, paint: "ink", width: q.hair },
        { d: petalLines, paint: "on-ink", width: q.hair },
        { d: inner, paint: "on-ink", width: q.hair },
        { d: ring(center), paint: "on-ink", width: q.rim },
      ],
      microRadius: null,
    };
  } else {
    const lines: SealLine[] = [
      { d: weave, paint: "paper", width: q.hair },
      { d: petalLines, paint: kind === "struck" ? "foil" : "ink", width: q.hair + (kind === "struck" ? 0.1 : 0) },
      { d: inner, paint: "ink", width: q.hair },
      { d: ring(center), paint: "ink", width: q.rim + 0.2 },
      { d: ring(band), paint: "ink", width: q.rim },
      { d: ring(micro ? 99.2 : 99), paint: "ink", width: micro ? q.rim : q.rim * 0.8 },
    ];
    drawing = { band: { d: solid, paint: "ink" }, lines, microRadius: micro ? 91.6 : null };
  }

  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  cache.set(key, drawing);
  return drawing;
}

/** Total characters of path data, which is what the browser has to parse. */
export function sealSize(drawing: SealDrawing): number {
  return drawing.band.d.length + drawing.lines.reduce((sum, line) => sum + line.d.length, 0);
}

/** An unstruck blank, like a coin's reeded edge: for skills that are ready to prove. */
export function reededEdge(): string {
  let d = "";
  for (let i = 0; i < 64; i++) {
    const a = (TAU * i) / 64;
    d += `M${pol(90, a)}L${pol(98, a)}`;
  }
  return d;
}
