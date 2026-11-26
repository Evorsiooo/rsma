import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import {
  at,
  autoSplits,
  drawnDirection,
  emptyGeometry,
  nearest,
  placeLabels,
  polyD,
  sample,
  segmentsOf,
  setDirection,
  slice,
  smoothPath,
  splitId,
  turnsOf,
  withLine,
  MAX_POINTS,
  MAX_SPLITS,
  MAX_TURNS,
  type Pt,
  type TrackGeometry,
} from "../../shared/track";
import { admin } from "../api";
import { Dialog, toast } from "../ui";

const STEPS = ["Image", "Trace", "Pit lane", "Start and direction", "Turns", "Segments"] as const;
type Step = 0 | 1 | 2 | 3 | 4 | 5;
type Sel = { kind: "pt" | "pit" | "turn" | "split" | "in" | "out"; i: number } | null;
/** Add places things, Delete removes whatever is clicked; Entry and Exit place the pit lane's ends on the lap. */
type Tool = "add" | "delete" | "entry" | "exit";

const CANVAS_W = 600;
const CANVAS_H = 420;
const MAX_SIDE = 1600;
const MAX_IMAGE_CHARS = 650_000;
const TEAL = "#3fd0b0";
const YELLOW = "#e8d44d";
const RED = "#e63a2e";
const wrap1 = (x: number) => ((x % 1) + 1) % 1;

interface Snap {
  g: TrackGeometry;
  closed: boolean;
}

/** Shrinks the imported picture in the browser to a JPEG tracing guide that fits in the database. */
async function shrink(file: File): Promise<{ url: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(100, Math.round(bmp.width * scale));
    const h = Math.max(100, Math.round(bmp.height * scale));
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext("2d")!;
    cx.fillStyle = "#000";
    cx.fillRect(0, 0, w, h);
    cx.drawImage(bmp, 0, 0, w, h);
    for (const q of [0.74, 0.6, 0.48]) {
      const url = cv.toDataURL("image/jpeg", q);
      if (url.length <= MAX_IMAGE_CHARS) return { url, w, h };
    }
    scale *= 0.75;
  }
  throw new Error("too_big");
}

export function TrackEditor({ trackId, onClose, onSaved }: { trackId: string | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [loaded, setLoaded] = useState(trackId === null);
  const [name, setName] = useState("");
  const [g, setG] = useState<TrackGeometry>(() => emptyGeometry(1600, 1000));
  const [closed, setClosed] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [fade, setFade] = useState<0 | 1 | 2>(0);
  const [step, setStep] = useState<Step>(0);
  const [sel, setSel] = useState<Sel>(null);
  const [tool, setTool] = useState<Tool>("add");
  const [hot, setHot] = useState<string | null>(null);
  const [hoverSeg, setHoverSeg] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: 1600, h: (1600 * CANVAS_H) / CANVAS_W });
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const history = useRef<Snap[]>([]);
  const [undoable, setUndoable] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const space = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  const gesture = useRef<null | { kind: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean } | { kind: "drag"; base: TrackGeometry; sel: NonNullable<Sel>; moved: boolean }>(null);

  /** The view that shows the whole drawing. */
  const fit = useCallback((geo: TrackGeometry) => {
    const ar = CANVAS_H / CANVAS_W;
    const w = Math.max(geo.w, geo.h / ar);
    setView({ x: -(w - geo.w) / 2, y: -(w * ar - geo.h) / 2, w, h: w * ar });
  }, []);

  useEffect(() => {
    if (!trackId) {
      fit(g);
      return;
    }
    admin.trackFull(trackId).then(
      (t) => {
        setName(t.name);
        setG(t.geometry);
        setClosed(t.geometry.line.length >= 3);
        setImage(t.image);
        fit(t.geometry);
        setStep(1);
        setLoaded(true);
      },
      () => {
        toast("Could not load the track.");
        onClose();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  const k = view.w / CANVAS_W; // drawing units per screen px
  const lap = useMemo(() => sample(g.line, true), [g.line]);
  const pit = useMemo(() => (g.pit ? sample(g.pit.line, false) : null), [g.pit]);

  const commit = (next: TrackGeometry, nextClosed = closed) => {
    history.current.push({ g, closed });
    if (history.current.length > 100) history.current.shift();
    setUndoable(true);
    setG(next);
    setClosed(nextClosed);
    setDirty(true);
  };
  const undo = () => {
    const s = history.current.pop();
    if (!s) return;
    setG(s.g);
    setClosed(s.closed);
    setSel(null);
    setUndoable(history.current.length > 0);
  };

  // ---- Coordinates and view -------------------------------------------------------

  const toDrawing = (e: { clientX: number; clientY: number }) => {
    const el = svg.current!;
    const r = el.getBoundingClientRect();
    return { x: view.x + ((e.clientX - r.left) / r.width) * view.w, y: view.y + ((e.clientY - r.top) / r.height) * view.h };
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, g.w / 40), Math.max(g.w, g.h * (CANVAS_W / CANVAS_H)) * 2);
      const f = w / v.w;
      return { x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f, w, h: w * (CANVAS_H / CANVAS_W) };
    });
  };
  const zoomCentre = (factor: number) => zoomAt(factor, view.x + view.w / 2, view.y + view.h / 2);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = view.x + ((e.clientX - r.left) / r.width) * view.w;
      const py = view.y + ((e.clientY - r.top) / r.height) * view.h;
      zoomAt(e.deltaY < 0 ? 0.8 : 1.25, px, py);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  // ---- Editing ----------------------------------------------------------------------

  const onLine = (x: number, y: number, tolerancePx = 14) => {
    if (!closed || lap.pts.length < 3) return null;
    const n = nearest(lap, x, y);
    return n.dist <= tolerancePx * k ? n : null;
  };

  const click = (x: number, y: number) => {
    setSel(null);
    if (tool === "delete") {
      // Deleting works on what is clicked: a segment's body removes that segment (it joins the one before).
      if (step === 5) {
        const n = onLine(x, y, 24);
        const seg = n && segs.find((q) => !q.pit && wrap1(n.u - q.from) < (wrap1(q.to - q.from) || 1));
        if (seg) commit({ ...g, splits: g.splits.filter((q) => q.id !== seg.id) });
      }
      return;
    }
    if (step === 1) {
      if (!closed) {
        if (g.line.length >= MAX_POINTS) return toast("Too many points.");
        commit({ ...g, line: [...g.line, { x, y }] });
        setSel({ kind: "pt", i: g.line.length });
      } else {
        const n = onLine(x, y, 12);
        if (!n || g.line.length >= MAX_POINTS) return;
        const line = [...g.line.slice(0, n.seg + 1), { x, y }, ...g.line.slice(n.seg + 1)];
        commit(withLine(g, line));
        setSel({ kind: "pt", i: n.seg + 1 });
      }
    } else if (step === 2) {
      if (tool === "add") {
        const cur = g.pit ?? { line: [] as Pt[], inU: 0, outU: 0 };
        if (cur.line.length >= MAX_POINTS) return;
        const line = [...cur.line, { x, y }];
        const first = line.length === 1 && closed ? nearest(lap, x, y).u : cur.inU;
        commit({ ...g, pit: { ...cur, line, inU: first, outU: cur.line.length === 0 ? first : cur.outU } });
        setSel({ kind: "pit", i: line.length - 1 });
      } else {
        const n = onLine(x, y, 40);
        if (!n || !g.pit) return;
        commit({ ...g, pit: { ...g.pit, [tool === "entry" ? "inU" : "outU"]: n.u } });
      }
    } else if (step === 3) {
      const n = onLine(x, y, 24);
      if (n) commit({ ...g, start: n.u });
    } else if (step === 4) {
      const n = onLine(x, y, 24);
      if (!n) return;
      if (g.turns.length >= MAX_TURNS) return toast("Too many turns.");
      commit({ ...g, turns: [...g.turns, n.u] });
      setSel({ kind: "turn", i: g.turns.length });
    } else if (step === 5) {
      const n = onLine(x, y, 24);
      if (!n) return;
      if (g.splits.length >= MAX_SPLITS) return toast("Too many segments.");
      commit({ ...g, splits: [...g.splits, { id: splitId(), u: n.u }] });
      setSel({ kind: "split", i: g.splits.length });
    }
  };

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: e.button === 1 || space.current };
    if (e.button === 1) e.preventDefault();
  };
  const startDrag = (e: RPointerEvent, s: NonNullable<Sel>) => {
    e.stopPropagation();
    (svg.current as Element).setPointerCapture(e.pointerId);
    setSel(s);
    gesture.current = { kind: "drag", base: g, sel: s, moved: false };
  };
  /** A press on something already placed: drags it, or deletes it when the Delete tool is on. */
  const grab = (e: RPointerEvent, s: NonNullable<Sel>) => {
    if (tool !== "delete") return startDrag(e, s);
    e.stopPropagation();
    removeItem(s);
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    const ges = gesture.current;
    if (!ges) {
      if (step === 5 && closed) {
        const p = toDrawing(e);
        const n = onLine(p.x, p.y, 16);
        const seg = n && segs.find((q) => !q.pit && wrap1(n.u - q.from) < (wrap1(q.to - q.from) || 1));
        setHoverSeg(seg ? seg.id : null);
      }
      return;
    }
    if (ges.kind === "pan") {
      const dx = e.clientX - ges.sx;
      const dy = e.clientY - ges.sy;
      if (!ges.moved && Math.hypot(dx, dy) < 4) return;
      ges.moved = true;
      setView((v) => ({ ...v, x: ges.vx - dx * k, y: ges.vy - dy * k }));
      return;
    }
    const p = toDrawing(e);
    if (!ges.moved) {
      history.current.push({ g: ges.base, closed });
      setUndoable(true);
      ges.moved = true;
      setDirty(true);
    }
    const b = ges.base;
    const s = ges.sel;
    if (s.kind === "pt") {
      setG(withLine(b, b.line.map((q, i) => (i === s.i ? { ...q, x: p.x, y: p.y } : q))));
    } else if (s.kind === "pit" && b.pit) {
      setG({ ...b, pit: { ...b.pit, line: b.pit.line.map((q, i) => (i === s.i ? { ...q, x: p.x, y: p.y } : q)) } });
    } else if (s.kind === "in" || s.kind === "out") {
      const u = nearest(sample(b.line, true), p.x, p.y).u;
      if (b.pit) setG({ ...b, pit: { ...b.pit, [s.kind === "in" ? "inU" : "outU"]: u } });
    } else if (s.kind === "turn" || s.kind === "split") {
      const u = nearest(sample(b.line, true), p.x, p.y).u;
      setG(s.kind === "turn" ? { ...b, turns: b.turns.map((t, i) => (i === s.i ? u : t)) } : { ...b, splits: b.splits.map((q, i) => (i === s.i ? { ...q, u } : q)) });
    }
  };
  const up = (e: RPointerEvent<SVGSVGElement>) => {
    const ges = gesture.current;
    gesture.current = null;
    if (!ges || ges.kind !== "pan" || ges.moved || e.button !== 0) return;
    const p = toDrawing(e);
    click(p.x, p.y);
  };

  // ---- Buttons ----------------------------------------------------------------------

  const removeItem = (target: NonNullable<Sel>) => {
    if (target.kind === "pt") {
      if (g.line.length <= 3 && closed) return toast("A lap needs at least 3 points.");
      commit(withLine(g, g.line.filter((_, i) => i !== target.i)), closed && g.line.length - 1 >= 3);
    } else if (target.kind === "pit" && g.pit) {
      const line = g.pit.line.filter((_, i) => i !== target.i);
      commit({ ...g, pit: line.length ? { ...g.pit, line } : null });
    } else if (target.kind === "turn") commit({ ...g, turns: g.turns.filter((_, i) => i !== target.i) });
    else if (target.kind === "split") commit({ ...g, splits: g.splits.filter((_, i) => i !== target.i) });
    setSel(null);
    setHot(null);
  };
  const remove = () => sel && removeItem(sel);
  const toggleSharp = () => {
    if (!sel || (sel.kind !== "pt" && sel.kind !== "pit")) return;
    if (sel.kind === "pt") commit({ ...g, line: g.line.map((q, i) => (i === sel.i ? { ...q, sharp: q.sharp ? undefined : true } : q)) });
    else if (g.pit) commit({ ...g, pit: { ...g.pit, line: g.pit.line.map((q, i) => (i === sel.i ? { ...q, sharp: q.sharp ? undefined : true } : q)) } });
  };
  const closeLoop = () => {
    if (g.line.length < 3) return;
    commit({ ...g, direction: drawnDirection(g.line) }, true);
    setSel(null);
  };
  const chooseDirection = (dir: "cw" | "ccw") => commit(setDirection({ ...g, direction: dir }, dir));
  const defaultSegments = () => commit({ ...g, splits: autoSplits(g).slice(0, MAX_SPLITS) });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.code === "Space") {
        space.current = e.type === "keydown";
        if (e.type === "keydown") e.preventDefault();
      }
      if (e.type !== "keydown") return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        e.preventDefault();
        remove();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener("keydown", key);
    document.addEventListener("keyup", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("keyup", key);
    };
  });

  const importImage = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await shrink(f);
      setImage(r.url);
      setFade(0);
      setDirty(true);
      if (g.line.length === 0 && !g.pit) {
        const ng = emptyGeometry(r.w, r.h);
        setG(ng);
        fit(ng);
      }
      setStep(1);
    } catch {
      toast("That picture could not be used.");
    }
  };

  const save = async () => {
    const geometry = setDirection(g, g.direction);
    if (!name.trim()) return toast("Give the track a name.");
    if (!closed || g.line.length < 3) return toast("Trace the lap and close the loop first.");
    setBusy(true);
    const body = { name: name.trim(), geometry, image };
    const r = trackId ? await admin.saveTrack(trackId, body) : await admin.createTrack(body);
    setBusy(false);
    if (!r.ok) return toast(r.error === "name_taken" ? "Another track has that name." : r.error === "invalid" ? "The track could not be saved." : "Saving failed.");
    toast("Track saved.", "green");
    onSaved(trackId ?? (r.data as { id: string }).id);
  };
  const tryClose = () => (dirty && !discard ? setDiscard(true) : onClose());

  // ---- Drawing ----------------------------------------------------------------------

  const turns = turnsOf(g);
  const segs = segmentsOf(g);
  const px = (n: number) => n * k;
  const del = tool === "delete";
  const handle = (p: Pt, key: string, selected: boolean, onDown: (e: RPointerEvent) => void, o: { dim?: boolean; inert?: boolean } = {}) => {
    const lit = selected || hot === key;
    const fill = lit ? (del && !selected ? RED : "#f0f0e8") : o.dim ? "#2e8f7a" : TEAL;
    return (
      <g key={key} onPointerDown={onDown} onPointerEnter={() => setHot(key)} onPointerLeave={() => setHot((h) => (h === key ? null : h))} style={{ cursor: del ? "pointer" : "grab", pointerEvents: o.inert ? "none" : undefined }}>
        <circle cx={p.x} cy={p.y} r={px(11)} fill="transparent" />
        {p.sharp ? (
          <rect x={p.x - px(4.5)} y={p.y - px(4.5)} width={px(9)} height={px(9)} transform={`rotate(45 ${p.x} ${p.y})`} fill={fill} />
        ) : (
          <rect x={p.x - px(3.5)} y={p.y - px(3.5)} width={px(7)} height={px(7)} fill={fill} />
        )}
      </g>
    );
  };
  const normal = (u: number) => {
    const p = at(lap, u);
    const nx = p.ty;
    const ny = -p.tx;
    const out = nx * (p.x - g.w / 2) + ny * (p.y - g.h / 2) > 0 ? 1 : -1;
    return { p, nx: nx * out, ny: ny * out };
  };
  const labelAt = (u: number, text: string, color: string, off: number) => {
    const { p, nx, ny } = normal(u);
    return (
      <text x={p.x + nx * px(off)} y={p.y + ny * px(off) + px(5.5)} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={px(16)} fill={color} style={{ pointerEvents: "none" }}>
        {text}
      </text>
    );
  };
  // Turn numbers (and, in the Segments step, segment names) that sit close together are spread out, with a leader line to their point.
  const showNames = step === 5;
  const spots = closed
    ? placeLabels(
        [
          ...turns.map((t) => {
            const { p, nx, ny } = normal(t.u);
            return { x: p.x, y: p.y, nx, ny, w: String(t.n).length * px(16) * 0.62, base: px(18) };
          }),
          ...(showNames
            ? g.splits.map((q) => {
                const { p, nx, ny } = normal(q.u);
                return { x: p.x, y: p.y, nx, ny, w: 3 * px(16) * 0.62, base: px(26) };
              })
            : []),
        ],
        { h: px(16), base: px(18), step: px(15) },
      )
    : [];
  const turnSpots = spots.slice(0, turns.length);
  const splitSpots = spots.slice(turns.length);
  const tick = (u: number, color: string, len: number) => {
    const p = at(lap, u);
    return <path d={`M${p.x + p.ty * px(len)},${p.y - p.tx * px(len)}L${p.x - p.ty * px(len)},${p.y + p.tx * px(len)}`} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />;
  };

  const f = lap.pts.length >= 3 ? at(lap, g.start) : null;
  const status = !closed ? `${g.line.length} points` : `${turns.length} turns, ${segs.length} segments`;
  const needsLine = !closed && step > 1;
  const sliceOf = (q: (typeof segs)[number]) => {
    const span = wrap1(q.to - q.from) || 1;
    const e = Math.min(0.004, span / 4);
    return polyD(slice(lap, q.from + e, q.from + span - e));
  };

  const row = (...c: React.ReactNode[]) => <div className="r-grid" style={{ ["--cols" as string]: c.length }}>{c}</div>;
  const btn = (label: string, on: () => void, o: { pressed?: boolean; disabled?: boolean; red?: boolean } = {}) => (
    <button key={label} className={o.pressed ? (o.red ? "r-btn red" : "r-btn pri") : "r-btn"} disabled={o.disabled} onClick={on}>
      {label}
    </button>
  );
  const pick = (t: Tool) => setTool(t);
  const addDelete = (add: string, delLabel: string) => row(btn(add, () => pick("add"), { pressed: tool === "add" }), btn(delLabel, () => pick("delete"), { pressed: tool === "delete", red: true }));

  return (
    <Dialog
      title={trackId ? `Edit track: ${name || "..."}` : "New track"}
      width={920}
      onClose={tryClose}
      foot={
        <>
          <span className="r-text" style={{ marginRight: "auto", alignSelf: "center" }}>{status}</span>
          <button className="r-btn" onClick={tryClose}>{discard ? "Discard changes" : "Cancel"}</button>
          <button className="r-btn pri" disabled={busy || !loaded} onClick={save}>Save track</button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ width: CANVAS_W, flex: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="r-grid" style={{ ["--cols" as string]: 5 }}>
            {btn("Zoom in", () => zoomCentre(0.7))}
            {btn("Zoom out", () => zoomCentre(1.4))}
            {btn("Fit", () => fit(g))}
            {btn("Undo", undo, { disabled: !undoable })}
            {btn(["Image full", "Image faded", "Image off"][fade], () => setFade(((fade + 1) % 3) as 0 | 1 | 2), { disabled: !image })}
          </div>
          <svg
            ref={svg}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ background: "#0a0b0b", border: "1px solid #0c1112", display: "block", touchAction: "none", cursor: gesture.current?.kind === "pan" ? "grabbing" : del ? "default" : "crosshair" }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerLeave={() => setHoverSeg(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {image && fade !== 2 && <image href={image} x={0} y={0} width={g.w} height={g.h} opacity={fade === 0 ? 0.9 : 0.35} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }} />}
            {!image && <rect x={0} y={0} width={g.w} height={g.h} fill="none" stroke="#2a2d2e" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {g.line.length >= 2 && (
              <path d={smoothPath(g.line, closed)} fill="none" stroke={TEAL} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            )}
            {step === 5 && closed && segs.filter((q) => !q.pit).map((q, i) => (
              <path key={q.id} d={sliceOf(q)} fill="none" stroke={hoverSeg === q.id ? (del ? RED : "#f0f0e8") : i % 2 ? "#7fb2ff" : TEAL} strokeWidth={hoverSeg === q.id ? 5 : 3} vectorEffect="non-scaling-stroke" strokeLinecap="round" style={{ pointerEvents: "none" }} />
            ))}
            {g.pit && g.pit.line.length >= 2 && (
              <path d={smoothPath(g.pit.line, false)} fill="none" stroke="#cfd3d6" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            )}
            {g.pit && closed && g.pit.line.length >= 2 && [g.pit.inU, g.pit.outU].map((u, i) => {
              const a = at(lap, u);
              const e = i === 0 ? g.pit!.line[0] : g.pit!.line[g.pit!.line.length - 1];
              return <path key={`c${i}`} d={`M${a.x},${a.y}L${e.x},${e.y}`} stroke="#cfd3d6" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />;
            })}
            {g.pit && closed && [g.pit.inU, g.pit.outU].map((u, i) => {
              const a = at(lap, u);
              const key = i === 0 ? "in" : "out";
              return (
                <g key={key} onPointerDown={step === 2 && !del ? (e) => startDrag(e, { kind: key, i: 0 }) : undefined} style={{ cursor: step === 2 && !del ? "grab" : undefined, pointerEvents: step === 2 ? undefined : "none" }}>
                  <circle cx={a.x} cy={a.y} r={px(11)} fill="transparent" />
                  <circle cx={a.x} cy={a.y} r={px(4)} fill={sel?.kind === key ? "#f0f0e8" : "#cfd3d6"} />
                  {labelAt(u, i === 0 ? "in" : "out", "#cfd3d6", 20)}
                </g>
              );
            })}
            {f && (
              <>
                {tick(g.start, "#f0f0e8", 10)}
                {(() => {
                  const a = at(lap, g.start + 0.012);
                  const s = px(9);
                  return <path d={`M${a.x + a.tx * s},${a.y + a.ty * s}L${a.x - a.tx * s * 0.5 - a.ty * s * 0.7},${a.y - a.ty * s * 0.5 + a.tx * s * 0.7}L${a.x - a.tx * s * 0.5 + a.ty * s * 0.7},${a.y - a.ty * s * 0.5 - a.tx * s * 0.7}Z`} fill="#f0f0e8" style={{ pointerEvents: "none" }} />;
                })()}
              </>
            )}
            {closed && turns.map((t, i) => {
              const a = at(lap, t.u);
              const sp = turnSpots[i];
              const key = `t${g.turns.indexOf(t.u)}`;
              const lit = (sel?.kind === "turn" && g.turns[sel.i] === t.u) || hot === key;
              return (
                <g key={`t${t.n}`}>
                  {sp && sp.d > px(18) + 0.01 && <line x1={a.x} y1={a.y} x2={sp.x} y2={sp.y} stroke="#8d9396" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />}
                  {sp && (
                    <text x={sp.x} y={sp.y + px(5.5)} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={px(16)} fill={lit && step === 4 ? (del ? RED : TEAL) : "#f0f0e8"} style={{ pointerEvents: "none" }}>
                      {t.n}
                    </text>
                  )}
                  {step === 4 && (
                    <g onPointerDown={(e) => grab(e, { kind: "turn", i: g.turns.indexOf(t.u) })} onPointerEnter={() => setHot(key)} onPointerLeave={() => setHot((h) => (h === key ? null : h))} style={{ cursor: del ? "pointer" : "grab" }}>
                      <circle cx={a.x} cy={a.y} r={px(9)} fill="transparent" />
                      <circle cx={a.x} cy={a.y} r={px(4)} fill={lit ? (del ? RED : "#f0f0e8") : TEAL} />
                    </g>
                  )}
                </g>
              );
            })}
            {closed && g.splits.map((s, i) => {
              const selected = sel?.kind === "split" && sel.i === i;
              const idx = segs.findIndex((q) => q.id === s.id);
              return (
                <g key={s.id}>
                  {tick(s.u, selected ? "#f0f0e8" : YELLOW, 9)}
                  {step === 5 && splitSpots[i] && (
                    <>
                      {splitSpots[i].d > px(26) + 0.01 && <line x1={at(lap, s.u).x} y1={at(lap, s.u).y} x2={splitSpots[i].x} y2={splitSpots[i].y} stroke="#8d9396" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />}
                      <text x={splitSpots[i].x} y={splitSpots[i].y + px(5.5)} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={px(16)} fill={YELLOW} style={{ pointerEvents: "none" }}>
                        {segs[idx]?.name ?? ""}
                      </text>
                    </>
                  )}
                  {step === 5 && !del && (
                    <g onPointerDown={(e) => startDrag(e, { kind: "split", i })} style={{ cursor: "grab" }}>
                      <circle cx={at(lap, s.u).x} cy={at(lap, s.u).y} r={px(9)} fill="transparent" />
                    </g>
                  )}
                </g>
              );
            })}
            {step === 1 && g.line.map((p, i) => handle(p, `p${i}`, sel?.kind === "pt" && sel.i === i, (e) => grab(e, { kind: "pt", i })))}
            {step === 2 && g.line.map((p, i) => handle(p, `q${i}`, false, () => {}, { dim: true, inert: true }))}
            {step === 2 && g.pit?.line.map((p, i) => handle(p, `pit${i}`, sel?.kind === "pit" && sel.i === i, (e) => grab(e, { kind: "pit", i }), { inert: tool === "entry" || tool === "exit" }))}
          </svg>
        </div>

        <div className="r-stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <input className="r-field" placeholder="Track name" aria-label="Track name" maxLength={60} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          <div className="r-header">Step</div>
          {STEPS.map((s, i) => btn(`${i + 1} ${s}`, () => { setStep(i as Step); setSel(null); setTool("add"); setHot(null); }, { pressed: step === i, disabled: i > 1 && g.line.length < 3 && !closed }))}
          <div className="r-header">{STEPS[step]}</div>
          {step === 0 && (
            <>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { importImage(e.target.files?.[0]); e.target.value = ""; }} />
              {row(btn(image ? "Replace image" : "Import image", () => file.current?.click()), btn("Remove image", () => { setImage(null); setDirty(true); }, { disabled: !image }))}
            </>
          )}
          {step === 1 && (
            <>
              {addDelete("Add point", "Delete point")}
              {row(btn("Sharp corner", toggleSharp, { pressed: sel?.kind === "pt" && !!g.line[sel.i]?.sharp, disabled: sel?.kind !== "pt" }), btn("Close loop", closeLoop, { disabled: closed || g.line.length < 3 }))}
              {btn("Clear lap", () => commit({ ...g, line: [], turns: [], splits: [], pit: null }, false), { disabled: g.line.length === 0 })}
            </>
          )}
          {step === 2 && (
            <>
              {addDelete("Add point", "Delete point")}
              {row(btn("Set entry", () => pick("entry"), { pressed: tool === "entry", disabled: !g.pit }), btn("Set exit", () => pick("exit"), { pressed: tool === "exit", disabled: !g.pit }))}
              {row(btn("Sharp corner", toggleSharp, { disabled: sel?.kind !== "pit" }), btn("Clear pit lane", () => { commit({ ...g, pit: null }); setSel(null); setTool("add"); }, { disabled: !g.pit }))}
            </>
          )}
          {step === 3 && (
            <>
              {row(btn("Clockwise", () => chooseDirection("cw"), { pressed: g.direction === "cw" }), btn("Counter-clockwise", () => chooseDirection("ccw"), { pressed: g.direction === "ccw" }))}
            </>
          )}
          {step === 4 && (
            <>
              {addDelete("Add turn", "Delete turn")}
              {btn("Clear turns", () => commit({ ...g, turns: [] }), { disabled: g.turns.length === 0 })}
            </>
          )}
          {step === 5 && (
            <>
              {addDelete("Add split", "Delete segment")}
              {row(btn("From turns", defaultSegments, { disabled: g.turns.length < 2 }), btn("Clear splits", () => commit({ ...g, splits: [] }), { disabled: g.splits.length === 0 }))}
            </>
          )}
          {needsLine && <div className="r-text">Close the loop in Trace first.</div>}
        </div>
      </div>
    </Dialog>
  );
}
