import { useMemo } from "react";
import type { MouseEvent } from "react";
import { at, polyD, sample, segmentsOf, slice, turnsOf, type Sampled, type TrackGeometry } from "../shared/track";

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
  onSegment?: (id: string, kind: "click" | "context", e: MouseEvent) => void;
  className?: string;
}

const COLORS = {
  dark: { track: "#6f7679", pit: "#55595d", text: "#f0f0e8", dim: "#8d9396", yellow: "#e8d44d", red: "#e63a2e", edge: "#0a0b0b" },
  light: { track: "#8c97b8", pit: "#b4bdd6", text: "#00206b", dim: "#6a76a0", yellow: "#f5c400", red: "#d62e24", edge: "#7a5f00" },
} as const;

const GAP = 0.003;

/** The geometry's drawing: lap, pit lane, finish line, direction arrow, turn numbers and flagged segments. */
export function TrackMap({ geometry: g, width, theme = "dark", yellow = [], pending = [], tint, labels = true, onSegment, className }: TrackMapProps) {
  const c = COLORS[theme];
  const d = useMemo(() => {
    const lap = sample(g.line, true);
    const pit: Sampled | null = g.pit ? sample(g.pit.line, false) : null;
    const segs = segmentsOf(g);
    const pts = [...lap.pts, ...(pit?.pts ?? [])];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const pad = Math.max(x1 - x0, y1 - y0) * 0.09 + 10;
    const box = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    return { lap, pit, segs, box, cx, cy };
  }, [g]);
  const { lap, pit, segs, box, cx, cy } = d;
  if (lap.pts.length < 3) return null;
  const k = box.w / width; // drawing units per px
  const fs = 16 * k;
  const height = Math.round(box.h / k);
  const yel = new Set(yellow);
  const pen = new Set(pending);
  const side = (u: number, off: number, inward = false) => {
    const p = at(lap, u);
    let nx = p.ty;
    let ny = -p.tx;
    const out = nx * (p.x - cx) + ny * (p.y - cy) > 0 ? 1 : -1;
    const s = (inward ? -out : out) * off * k;
    nx *= s;
    ny *= s;
    return { x: p.x + nx, y: p.y + ny, p };
  };
  const f = at(lap, g.start);
  const arrow = at(lap, g.start + 0.035);
  const tintC = tint === "red" ? c.red : c.yellow;

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
  const flag = (id: string, kind: "click" | "context") => (e: MouseEvent) => {
    if (!onSegment) return;
    e.preventDefault();
    onSegment(id, kind, e);
  };

  return (
    <svg className={className} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} width={width} height={height} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }} role="img" aria-label="Track map">
      <style>{`@keyframes tm-b{0%,49%{opacity:1}50%,100%{opacity:.25}}.tm-b{animation:tm-b 1s steps(1,end) infinite}@media (prefers-reduced-motion:reduce){.tm-b{animation:none}}`}</style>
      {tint && <path d={polyD(slice(lap, 0, 1))} fill="none" stroke={tintC} strokeOpacity={0.35} strokeWidth={16} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
      {segs.map((s) => {
        const path = segPath(s);
        const isY = yel.has(s.id);
        const isP = pen.has(s.id);
        const edge = theme === "light" && isY;
        return (
          <g key={s.id}>
            {edge && <path d={path} fill="none" stroke={c.edge} strokeWidth={s.pit ? 6 : 9} vectorEffect="non-scaling-stroke" />}
            <path d={path} fill="none" stroke={isY ? c.yellow : s.pit ? c.pit : c.track} strokeWidth={s.pit ? 3 : 6} vectorEffect="non-scaling-stroke" />
            {isP && <path className="tm-b" d={path} fill="none" stroke={c.yellow} strokeWidth={s.pit ? 3 : 6} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />}
            {onSegment && (
              <path d={path} fill="none" stroke="transparent" strokeWidth={s.pit ? 12 : 18} vectorEffect="non-scaling-stroke" style={{ cursor: "pointer" }} onClick={flag(s.id, "click")} onContextMenu={flag(s.id, "context")} />
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
        segs
          .filter((s) => (yel.has(s.id) || pen.has(s.id)) && !s.pit)
          .map((s) => {
            const span = (((s.to - s.from) % 1) + 1) % 1 || 1;
            const m = side(s.from + span / 2, 22, true);
            return (
              <text key={s.id} x={m.x} y={m.y + fs * 0.35} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={fs} fill={yel.has(s.id) ? c.yellow : c.dim}>
                {s.name}
              </text>
            );
          })}
      {turnsOf(g).map((t) => {
        const m = side(t.u, 15);
        return (
          <text key={t.n} x={m.x} y={m.y + fs * 0.35} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={fs} fill={c.text}>
            {t.n}
          </text>
        );
      })}
      <path d={`M${f.x + f.ty * 8 * k},${f.y - f.tx * 8 * k}L${f.x - f.ty * 8 * k},${f.y + f.tx * 8 * k}`} stroke={c.text} strokeWidth={3} vectorEffect="non-scaling-stroke" />
      <path
        d={`M${arrow.x + arrow.tx * 6 * k},${arrow.y + arrow.ty * 6 * k}L${arrow.x - arrow.tx * 4 * k - arrow.ty * 5 * k},${arrow.y - arrow.ty * 4 * k + arrow.tx * 5 * k}L${arrow.x - arrow.tx * 4 * k + arrow.ty * 5 * k},${arrow.y - arrow.ty * 4 * k - arrow.tx * 5 * k}Z`}
        fill={c.text}
      />
    </svg>
  );
}
