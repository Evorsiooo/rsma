import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { at, CHAR_EM, layoutLabels, polyD, sample, segmentsOf, slice, turnsOf, type Sampled, type TrackGeometry } from "../shared/track";

export type MapTint = "yellow" | "red";

export interface TrackMapProps {
  geometry: TrackGeometry;
  /** Width in px; the height follows the track's shape. */
  width: number;
  /** "dark" on the panels, "light" on the public site. */
  theme?: "dark" | "light";
  /** Segment ids flagged yellow for everyone. */
  yellow?: string[];
  /** Segment ids a team reported (stewards only): dashed and blinking. */
  pending?: string[];
  /** The whole lap under a global yellow or red flag. */
  tint?: MapTint;
  /** Names flagged segments (S4) beside them. On by default. */
  labels?: boolean;
  /**
   * Makes the segments flaggable. Press and drag across segments with the left button ("click") or the right button
   * ("context"); on release the ids touched are handed over, in the order they were crossed. One segment is a plain click.
   */
  onSegments?: (ids: string[], kind: "click" | "context") => void;
  className?: string;
}

const COLORS = {
  dark: { track: "#6f7679", pit: "#55595d", text: "#f0f0e8", dim: "#8d9396", yellow: "#e8d44d", red: "#e63a2e", edge: "#0a0b0b", hover: "#3fd0b0", poi: "#8d9396", ring: "#0a0b0b" },
  light: { track: "#8c97b8", pit: "#b4bdd6", text: "#00206b", dim: "#6a76a0", yellow: "#f5c400", red: "#d62e24", edge: "#7a5f00", hover: "#3a63c8", poi: "#1f4fc4", ring: "#ffffff" },
} as const;

const GAP = 0.003;
/** Font size of turn numbers and labels, in px. */
const FONT = 12;

/** The geometry's drawing: lap, pit lane, finish line, direction arrow, turn numbers and flagged segments. */
export function TrackMap({ geometry: g, width, theme = "dark", yellow = [], pending = [], tint, labels = true, onSegments, className }: TrackMapProps) {
  const c = COLORS[theme];
  const [paint, setPaint] = useState<{ ids: string[]; kind: "click" | "context" } | null>(null);
  const live = useRef(paint);
  live.current = paint;
  const apply = useRef(onSegments);
  apply.current = onSegments;
  useEffect(() => {
    if (!paint) return;
    const end = () => {
      const p = live.current;
      setPaint(null);
      if (p) apply.current?.(p.ids, p.kind);
    };
    const cancel = () => setPaint(null);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [paint === null]);
  const d = useMemo(() => {
    const lap = sample(g.line, true);
    const pit: Sampled | null = g.pit ? sample(g.pit.line, false) : null;
    const segs = segmentsOf(g);
    const pts = [...lap.pts, ...(pit?.pts ?? []), ...(g.pois ?? []).map((q): [number, number] => [q.x, q.y])];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.09 + 10;
    // A point of interest near the edge makes room for its label on both sides.
    const kEst = (x1 - x0 + 2 * pad) / width;
    for (const q of g.pois ?? []) {
      const w = q.label.length * FONT * CHAR_EM * kEst + 8 * kEst;
      x0 = Math.min(x0, q.x - w); x1 = Math.max(x1, q.x + w);
      y0 = Math.min(y0, q.y - FONT * kEst); y1 = Math.max(y1, q.y + FONT * kEst);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const box = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    return { lap, pit, segs, box, cx, cy };
  }, [g, width]);
  const { lap, pit, segs, box, cx, cy } = d;
  if (lap.pts.length < 3) return null;
  const k = box.w / width; // drawing units per px
  const fs = FONT * k;
  const height = Math.round(box.h / k);
  const yel = new Set(yellow);
  const pen = new Set(pending);
  const side = (u: number, off: number) => {
    const p = at(lap, u);
    const nx = p.ty;
    const ny = -p.tx;
    const out = nx * (p.x - cx) + ny * (p.y - cy) > 0 ? 1 : -1;
    return { x: p.x - out * nx * off * k, y: p.y - out * ny * off * k, p };
  };
  const f = at(lap, g.start);
  const arrow = at(lap, g.start + 0.035);
  const tintC = tint === "red" ? c.red : c.yellow;

  const flagged = segs.filter((s) => (yel.has(s.id) || pen.has(s.id)) && !s.pit);
  const labelSet = layoutLabels(g, lap, pit, {
    cx,
    cy,
    k,
    fs,
    bounds: { x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h },
    extra: labels ? flagged.map((s) => ({ key: s.id, u: s.from + ((((s.to - s.from) % 1) + 1) % 1 || 1) / 2, chars: s.name.length, base: 22 * k, inward: true })) : [],
  });
  const turnLabels = labelSet.turns;

  const segPath = (s: (typeof segs)[number]) => {
    if (s.pit) {
      if (!pit) return "";
      const a = at(lap, s.from);
      const b = at(lap, s.to);
      return `M${a.x.toFixed(1)},${a.y.toFixed(1)}${polyD(slice(pit, 0, 1, 0.02)).replace(/^M/, "L")}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    }
    const span = (((s.to - s.from) % 1) + 1) % 1 || 1;
    const e = Math.min(GAP, span / 4);
    return polyD(slice(lap, s.from + e, s.from + span - e));
  };
  const begin = (id: string) => (e: PointerEvent) => {
    if (!onSegments || (e.button !== 0 && e.button !== 2)) return;
    e.preventDefault();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setPaint({ ids: [id], kind: e.button === 0 ? "click" : "context" });
  };
  const sweep = (e: PointerEvent) => {
    if (!live.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-seg]");
    const id = el?.getAttribute("data-seg");
    if (id && !live.current.ids.includes(id)) setPaint({ ...live.current, ids: [...live.current.ids, id] });
  };

  return (
    <svg className={className} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} width={width} height={height} style={{ display: "block", margin: "0 auto", maxWidth: "100%", ["--tm-hover" as string]: c.hover, ...(onSegments ? { touchAction: "none", userSelect: "none" } : {}) }} role="img" aria-label="Track map" onPointerMove={onSegments ? sweep : undefined} onContextMenu={onSegments ? (e) => e.preventDefault() : undefined}>
      <style>{`@keyframes tm-b{0%,49%{opacity:1}50%,100%{opacity:.25}}.tm-b{animation:tm-b 1s steps(1,end) infinite}.tm-h:hover .tm-v{stroke:var(--tm-hover)}@media (prefers-reduced-motion:reduce){.tm-b{animation:none}}`}</style>
      {tint && <path d={polyD(slice(lap, 0, 1))} fill="none" stroke={tintC} strokeOpacity={0.35} strokeWidth={16} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {segs.map((s) => {
        const path = segPath(s);
        const isY = yel.has(s.id);
        const isP = pen.has(s.id);
        const edge = theme === "light" && isY;
        return (
          <g key={s.id} className={onSegments ? "tm-h" : undefined}>
            {edge && <path d={path} fill="none" stroke={c.edge} strokeWidth={s.pit ? 6 : 9} vectorEffect="non-scaling-stroke" />}
            <path className="tm-v" d={path} fill="none" stroke={isY ? c.yellow : s.pit ? c.pit : c.track} strokeWidth={s.pit ? 3 : 6} vectorEffect="non-scaling-stroke" />
            {isP && <path className="tm-b" d={path} fill="none" stroke={c.yellow} strokeWidth={s.pit ? 3 : 6} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
            {paint?.ids.includes(s.id) && <path d={path} fill="none" stroke={c.hover} strokeWidth={s.pit ? 3 : 6} strokeDasharray={paint.kind === "context" ? "5 5" : undefined} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />}
            {onSegments && (
              <path data-seg={s.id} d={path} fill="none" stroke="transparent" strokeWidth={s.pit ? 12 : 18} vectorEffect="non-scaling-stroke" style={{ cursor: "pointer" }} onPointerDown={begin(s.id)} />
            )}
          </g>
        );
      })}
      {g.pit && pit && (
        <>
          {[g.pit.inU, g.pit.outU].map((u, i) => {
            const a = at(lap, u);
            const e = i === 0 ? pit.pts[0] : pit.pts[pit.pts.length - 1];
            return <path key={i} d={`M${a.x.toFixed(1)},${a.y.toFixed(1)}L${e[0].toFixed(1)},${e[1].toFixed(1)}`} stroke={c.pit} strokeWidth={3} fill="none" vectorEffect="non-scaling-stroke" />;
          })}
        </>
      )}
      {labels &&
        labelSet.extra.map((m) => {
          const s = flagged.find((q) => q.id === m.key)!;
          return (
            <g key={m.key}>
              {m.d > 22 * k + 0.01 && <line x1={m.ax} y1={m.ay} x2={m.x - m.ux * fs * 0.55} y2={m.y - m.uy * fs * 0.55} stroke={c.dim} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              <text x={m.x} y={m.y + fs * 0.35} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={fs} fill={yel.has(s.id) ? c.yellow : c.dim}>
                {s.name}
              </text>
            </g>
          );
        })}
      {labelSet.pois.map((q) => (
        <g key={q.id} style={{ pointerEvents: "none" }}>
          <circle cx={q.x} cy={q.y} r={3 * k} fill={c.poi} stroke={c.ring} strokeWidth={1.5 * k} />
          <text x={q.tx} y={q.ty + fs * 0.35} textAnchor={q.anchor} fontFamily="PerfectDOSVGA, monospace" fontSize={fs} fill={c.poi}>
            {q.label}
          </text>
        </g>
      ))}
      {turnLabels.map((t) => (
        <g key={t.n}>
          {t.d > 15 * k + 0.01 && <line x1={t.ax} y1={t.ay} x2={t.x - t.ux * fs * 0.55} y2={t.y - t.uy * fs * 0.55} stroke={c.dim} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          <text x={t.x} y={t.y + fs * 0.35} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={fs} fill={c.text}>
            {t.n}
          </text>
        </g>
      ))}
      <path d={`M${f.x + f.ty * 8 * k},${f.y - f.tx * 8 * k}L${f.x - f.ty * 8 * k},${f.y + f.tx * 8 * k}`} stroke={c.text} strokeWidth={3} vectorEffect="non-scaling-stroke" />
      <path
        d={`M${arrow.x + arrow.tx * 6 * k},${arrow.y + arrow.ty * 6 * k}L${arrow.x - arrow.tx * 4 * k - arrow.ty * 5 * k},${arrow.y - arrow.ty * 4 * k + arrow.tx * 5 * k}L${arrow.x - arrow.tx * 4 * k + arrow.ty * 5 * k},${arrow.y - arrow.ty * 4 * k - arrow.tx * 5 * k}Z`}
        fill={c.text}
      />
    </svg>
  );
}
