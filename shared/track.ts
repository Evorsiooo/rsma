/**
 * Track maps. A track is a closed line (the lap) with an optional pit lane, a finish line, numbered turns and splits
 * that cut the lap into the segments stewards flag.
 *
 * Everything on the line is a position `u` from 0 to 1 along the lap, by arc length, measured from the first point of
 * `line`. `lapT` gives the position from the finish line in the direction of travel, so live car positions
 * (one number per car) can later be drawn and matched to segments without any change to what is stored.
 */

export interface Pt {
  x: number;
  y: number;
  /** A corner: the curve does not smooth through this point. */
  sharp?: boolean;
}

export interface Split {
  /** Stable. Zones refer to the segment that starts at this split. */
  id: string;
  u: number;
}

export interface PitLane {
  /** Open line from the pit entry to the pit exit, in the direction of travel. */
  line: Pt[];
  /** Where the pit lane leaves and rejoins the lap. */
  inU: number;
  outU: number;
}

export interface TrackGeometry {
  /** Size of the drawing space (the imported image, shrunk). */
  w: number;
  h: number;
  /** Closed lap, in the direction of travel. */
  line: Pt[];
  direction: "cw" | "ccw";
  /** The finish line, as a position on the lap. */
  start: number;
  /** Turns as positions. They are numbered 1, 2, 3 in lap order from the finish line. */
  turns: number[];
  splits: Split[];
  pit: PitLane | null;
}

export interface TrackSegment {
  /** The id of the split it starts at, or "pit" for the pit lane. */
  id: string;
  /** S1, S2 in lap order from the finish line, or PIT. */
  name: string;
  from: number;
  to: number;
  pit?: boolean;
}

export const MAX_POINTS = 400;
export const MAX_TURNS = 60;
export const MAX_SPLITS = 60;
export const MAX_SIZE = 4000;
export const PIT_ID = "pit";

const wrap = (u: number) => ((u % 1) + 1) % 1;

export function emptyGeometry(w: number, h: number): TrackGeometry {
  return { w, h, line: [], direction: "cw", start: 0, turns: [], splits: [], pit: null };
}

/** Position from the finish line along the direction of travel. */
export const lapT = (g: Pick<TrackGeometry, "start">, u: number) => wrap(u - g.start);

// ---- Curve --------------------------------------------------------------------

type Cubic = [Pt, Pt, Pt, Pt];

/** Catmull-Rom through the points as cubic Béziers. A sharp point keeps its corner. */
export function cubics(points: Pt[], closed: boolean): Cubic[] {
  const n = points.length;
  const out: Cubic[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p0 = closed ? points[(i - 1 + n) % n] : points[Math.max(0, i - 1)];
    const p3 = closed ? points[(i + 2) % n] : points[Math.min(n - 1, i + 2)];
    const c1 = p1.sharp ? p1 : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = p2.sharp ? p2 : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    out.push([p1, c1, c2, p2]);
  }
  return out;
}

const bez = (c: Cubic, t: number): [number, number] => {
  const m = 1 - t;
  const a = m * m * m, b = 3 * m * m * t, d = 3 * m * t * t, e = t * t * t;
  return [a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y];
};

/** The curve as an SVG path (for the line itself). */
export function smoothPath(points: Pt[], closed: boolean): string {
  if (points.length < 2) return "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (const [, c1, c2, p] of cubics(points, closed)) {
    d += `C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }
  return closed ? d + "Z" : d;
}

/** The curve as a dense polyline with running lengths, so positions can be turned into points and back. */
export interface Sampled {
  pts: [number, number][];
  cum: number[];
  len: number;
  closed: boolean;
}

export const PER = 24;

export function sample(points: Pt[], closed: boolean, per = PER): Sampled {
  const pts: [number, number][] = [];
  if (points.length >= 2) {
    const cs = cubics(points, closed);
    for (const c of cs) for (let i = 0; i < per; i++) pts.push(bez(c, i / per));
    const last = cs[cs.length - 1][3];
    pts.push([last.x, last.y]);
  } else if (points.length === 1) pts.push([points[0].x, points[0].y]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] ?? 0, closed };
}

/** The point at position u, with the unit direction of travel there. */
export function at(s: Sampled, u: number): { x: number; y: number; tx: number; ty: number } {
  if (s.pts.length < 2 || s.len === 0) return { x: s.pts[0]?.[0] ?? 0, y: s.pts[0]?.[1] ?? 0, tx: 1, ty: 0 };
  const d = (s.closed ? wrap(u) : Math.min(1, Math.max(0, u))) * s.len;
  let lo = 0;
  let hi = s.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = s.pts[lo];
  const [x1, y1] = s.pts[hi];
  const seg = s.cum[hi] - s.cum[lo] || 1;
  const f = (d - s.cum[lo]) / seg;
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, tx: (x1 - x0) / l, ty: (y1 - y0) / l };
}

/** The position on the line nearest to a point, and how far the point is from it. */
export function nearest(s: Sampled, x: number, y: number): { u: number; dist: number; seg: number } {
  let best = { d2: Infinity, along: 0, seg: 0 };
  for (let i = 1; i < s.pts.length; i++) {
    const [x0, y0] = s.pts[i - 1];
    const [x1, y1] = s.pts[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    const f = l2 ? Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
    const px = x0 + dx * f;
    const py = y0 + dy * f;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 < best.d2) best = { d2, along: s.cum[i - 1] + (s.cum[i] - s.cum[i - 1]) * f, seg: Math.floor((i - 1) / PER) };
  }
  return { u: s.len ? best.along / s.len : 0, dist: Math.sqrt(best.d2), seg: best.seg };
}

/** Points along the line from u0 to u1 (going on through the start of the lap when u1 is before u0). */
export function slice(s: Sampled, u0: number, u1: number, step = 0.004): [number, number][] {
  const span = wrap(u1 - u0) || (u1 === u0 ? 0 : 1);
  const n = Math.max(2, Math.ceil(span / step));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const p = at(s, u0 + (span * i) / n);
    out.push([p.x, p.y]);
  }
  return out;
}

export const polyD = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");

// ---- Turns and segments ---------------------------------------------------------

/** Turns in lap order, numbered from 1. */
export function turnsOf(g: TrackGeometry): { n: number; u: number }[] {
  return [...g.turns].sort((a, b) => lapT(g, a) - lapT(g, b)).map((u, i) => ({ n: i + 1, u }));
}

/** The pieces of the lap stewards can flag, in lap order from the finish line, then the pit lane. */
export function segmentsOf(g: TrackGeometry): TrackSegment[] {
  const sp = [...g.splits].sort((a, b) => lapT(g, a.u) - lapT(g, b.u));
  const out: TrackSegment[] = sp.map((s, i) => ({ id: s.id, name: `S${i + 1}`, from: s.u, to: sp[(i + 1) % sp.length].u }));
  if (g.pit) out.push({ id: PIT_ID, name: "PIT", from: g.pit.inU, to: g.pit.outU, pit: true });
  return out;
}

/** Splits halfway between each pair of consecutive turns: the default segments. */
export function autoSplits(g: TrackGeometry, newId: () => string = splitId): Split[] {
  const t = turnsOf(g);
  if (t.length < 2) return [];
  return t.map((turn, i) => {
    const next = t[(i + 1) % t.length];
    const span = wrap(next.u - turn.u) || 1;
    return { id: newId(), u: wrap(turn.u + span / 2) };
  });
}

export const splitId = () => Math.random().toString(36).slice(2, 8);

/** The turn numbers a segment covers, for messages ("turns 3 to 4"); empty when it has none. */
export function turnsIn(g: TrackGeometry, seg: TrackSegment): number[] {
  if (seg.pit) return [];
  const span = wrap(seg.to - seg.from) || 1;
  return turnsOf(g).filter((t) => wrap(t.u - seg.from) < span).map((t) => t.n);
}

/** "turn 3", "turns 3 to 4", "turns 3 to 5", or the segment name when it holds no turn. */
export function segmentLabel(g: TrackGeometry, seg: TrackSegment): string {
  const t = turnsIn(g, seg);
  if (t.length === 0) return seg.pit ? "the pit lane" : seg.name;
  if (t.length === 1) return `turn ${t[0]}`;
  return `turns ${t[0]} to ${t[t.length - 1]}`;
}

/**
 * A new line for the track. Turns, splits, the finish line and the pit entry and exit stay at the same places on the
 * circuit (found again by their coordinates), not at the same fraction of a lap that just got a different length.
 */
export function withLine(base: TrackGeometry, line: Pt[]): TrackGeometry {
  if (base.line.length < 3 || line.length < 3) return { ...base, line };
  const old = sample(base.line, true);
  const next = sample(line, true);
  const move = (u: number) => {
    const p = at(old, u);
    return roundU(nearest(next, p.x, p.y).u);
  };
  return {
    ...base,
    line,
    start: move(base.start),
    turns: base.turns.map(move),
    splits: base.splits.map((s) => ({ ...s, u: move(s.u) })),
    pit: base.pit ? { ...base.pit, inU: move(base.pit.inU), outU: move(base.pit.outU) } : null,
  };
}

// ---- Direction ------------------------------------------------------------------

/** Shoelace area of the control points in screen coordinates (y down): positive is clockwise. */
export function drawnDirection(line: Pt[]): "cw" | "ccw" {
  let a = 0;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const q = line[(i + 1) % line.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a >= 0 ? "cw" : "ccw";
}

/**
 * Makes the lap run the given way. The line is reversed when it was drawn the other way, and every position moves
 * with it, so the turns and splits stay where they were on the circuit.
 */
export function setDirection(g: TrackGeometry, dir: "cw" | "ccw"): TrackGeometry {
  if (g.line.length < 3) return { ...g, direction: dir };
  if (drawnDirection(g.line) === dir) return g.direction === dir ? g : { ...g, direction: dir };
  const flip = (u: number) => wrap(1 - u);
  return {
    ...g,
    direction: dir,
    line: [g.line[0], ...g.line.slice(1).reverse()],
    start: flip(g.start),
    turns: g.turns.map(flip),
    splits: g.splits.map((s) => ({ ...s, u: flip(s.u) })),
    pit: g.pit ? { line: [...g.pit.line].reverse(), inU: flip(g.pit.outU), outU: flip(g.pit.inU) } : null,
  };
}

// ---- Validation -----------------------------------------------------------------

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

function cleanPoints(v: unknown, min: number): Pt[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > MAX_POINTS) return null;
  const out: Pt[] = [];
  for (const p of v) {
    const x = num(p?.x, -MAX_SIZE, MAX_SIZE * 2);
    const y = num(p?.y, -MAX_SIZE, MAX_SIZE * 2);
    if (x == null || y == null) return null;
    out.push(p.sharp === true ? { x: round(x), y: round(y), sharp: true } : { x: round(x), y: round(y) });
  }
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;
const roundU = (n: number) => Math.round(n * 1e6) / 1e6;

/** A geometry from untrusted input, or null when it is not a valid track. */
export function validateGeometry(v: unknown): TrackGeometry | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const w = num(o.w, 100, MAX_SIZE);
  const h = num(o.h, 100, MAX_SIZE);
  const line = cleanPoints(o.line, 3);
  const start = num(o.start, 0, 1);
  if (w == null || h == null || !line || start == null || (o.direction !== "cw" && o.direction !== "ccw")) return null;
  if (!Array.isArray(o.turns) || o.turns.length > MAX_TURNS || !Array.isArray(o.splits) || o.splits.length > MAX_SPLITS) return null;
  const turns: number[] = [];
  for (const t of o.turns) {
    const u = num(t, 0, 1);
    if (u == null) return null;
    turns.push(roundU(u));
  }
  const splits: Split[] = [];
  const seen = new Set<string>([PIT_ID]);
  for (const s of o.splits as { id?: unknown; u?: unknown }[]) {
    const u = num(s?.u, 0, 1);
    if (u == null || typeof s.id !== "string" || !/^[a-z0-9]{1,12}$/.test(s.id) || seen.has(s.id)) return null;
    seen.add(s.id);
    splits.push({ id: s.id, u: roundU(u) });
  }
  let pit: PitLane | null = null;
  if (o.pit != null) {
    const p = o.pit as Record<string, unknown>;
    const pl = cleanPoints(p.line, 2);
    const inU = num(p.inU, 0, 1);
    const outU = num(p.outU, 0, 1);
    if (!pl || inU == null || outU == null) return null;
    pit = { line: pl, inU: roundU(inU), outU: roundU(outU) };
  }
  return { w, h, line, direction: o.direction, start: roundU(start), turns, splits, pit };
}

/** What the public API returns for one track. */
export interface TrackInfo {
  id: string;
  name: string;
  version: number;
  geometry: TrackGeometry;
}

/** One row of the admin list. */
export interface TrackListItem {
  id: string;
  name: string;
  version: number;
  /** Events that run on it. */
  events: number;
  segments: number;
  turns: number;
}
