import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import {
  at,
  autoSplits,
  drawnDirection,
  emptyGeometry,
  nearest,
  sample,
  segmentsOf,
  setDirection,
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
type Sel = { kind: "pt" | "pit" | "turn" | "split"; i: number } | null;
type PitTool = "add" | "entry" | "exit";

const CANVAS_W = 600;
const CANVAS_H = 420;
const MAX_SIDE = 1600;
const MAX_IMAGE_CHARS = 650_000;
const TEAL = "#3fd0b0";
const YELLOW = "#e8d44d";

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
  const [pitTool, setPitTool] = useState<PitTool>("add");
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
      if (pitTool === "add") {
        const cur = g.pit ?? { line: [] as Pt[], inU: 0, outU: 0 };
        if (cur.line.length >= MAX_POINTS) return;
        const line = [...cur.line, { x, y }];
        const first = line.length === 1 && closed ? nearest(lap, x, y).u : cur.inU;
        commit({ ...g, pit: { ...cur, line, inU: first, outU: cur.line.length === 0 ? first : cur.outU } });
        setSel({ kind: "pit", i: line.length - 1 });
      } else {
        const n = onLine(x, y, 24);
        if (!n || !g.pit) return;
        commit({ ...g, pit: { ...g.pit, [pitTool === "entry" ? "inU" : "outU"]: n.u } });
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
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    const ges = gesture.current;
    if (!ges) return;
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

  const remove = () => {
    if (!sel) return;
    if (sel.kind === "pt") {
      if (g.line.length <= 3 && closed) return toast("A lap needs at least 3 points.");
      commit(withLine(g, g.line.filter((_, i) => i !== sel.i)), closed && g.line.length - 1 >= 3);
    } else if (sel.kind === "pit" && g.pit) {
      const line = g.pit.line.filter((_, i) => i !== sel.i);
      commit({ ...g, pit: line.length ? { ...g.pit, line } : null });
    } else if (sel.kind === "turn") commit({ ...g, turns: g.turns.filter((_, i) => i !== sel.i) });
    else if (sel.kind === "split") commit({ ...g, splits: g.splits.filter((_, i) => i !== sel.i) });
    setSel(null);
  };
  const toggleSharp = () => {
    if (!sel || sel.kind === "turn" || sel.kind === "split") return;
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
  const handle = (p: Pt, key: string, selected: boolean, onDown: (e: RPointerEvent) => void, dim = false) => (
    <g key={key} onPointerDown={onDown} style={{ cursor: "grab" }}>
      <circle cx={p.x} cy={p.y} r={px(11)} fill="transparent" />
      {p.sharp ? (
        <rect x={p.x - px(4.5)} y={p.y - px(4.5)} width={px(9)} height={px(9)} transform={`rotate(45 ${p.x} ${p.y})`} fill={selected ? "#f0f0e8" : dim ? "#2e8f7a" : TEAL} />
      ) : (
        <rect x={p.x - px(3.5)} y={p.y - px(3.5)} width={px(7)} height={px(7)} fill={selected ? "#f0f0e8" : dim ? "#2e8f7a" : TEAL} />
      )}
    </g>
  );
  const labelAt = (u: number, text: string, color: string, off: number) => {
    const p = at(lap, u);
    const nx = p.ty;
    const ny = -p.tx;
    const cx = g.w / 2;
    const cy = g.h / 2;
    const out = nx * (p.x - cx) + ny * (p.y - cy) > 0 ? 1 : -1;
    return (
      <text x={p.x + nx * out * px(off)} y={p.y + ny * out * px(off) + px(5.5)} textAnchor="middle" fontFamily="PerfectDOSVGA, monospace" fontSize={px(16)} fill={color} style={{ pointerEvents: "none" }}>
        {text}
      </text>
    );
  };
  const tick = (u: number, color: string, len: number) => {
    const p = at(lap, u);
    return <path d={`M${p.x + p.ty * px(len)},${p.y - p.tx * px(len)}L${p.x - p.ty * px(len)},${p.y + p.tx * px(len)}`} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />;
  };

  const f = lap.pts.length >= 3 ? at(lap, g.start) : null;
  const status = !closed ? `${g.line.length} points` : `${turns.length} turns, ${segs.length} segments`;
  const needsLine = !closed && step > 1;

  const row = (...c: React.ReactNode[]) => <div className="r-grid" style={{ ["--cols" as string]: c.length }}>{c}</div>;
  const btn = (label: string, on: () => void, o: { pressed?: boolean; disabled?: boolean } = {}) => (
    <button key={label} className="r-btn" aria-pressed={o.pressed} disabled={o.disabled} onClick={on}>
      {label}
    </button>
  );

  return (
    <Dialog
      title={trackId ? `Edit track: ${name || "..."}` : "New track"}
      width={920}
      onClose={tryClose}
      foot={
        <>
          <span className="r-text" style={{ marginRight: "auto", alignSelf: "center" }}>{status}</span>
          <button className="r-btn" onClick={tryClose}>{discard ? "Discard changes" : "Cancel"}</button>
          <button className="r-btn r-btn--advance" disabled={busy || !loaded} onClick={save}>Save track</button>
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
            style={{ background: "#0a0b0b", border: "1px solid #0c1112", display: "block", touchAction: "none", cursor: gesture.current?.kind === "pan" ? "grabbing" : "crosshair" }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onContextMenu={(e) => e.preventDefault()}
          >
            {image && fade !== 2 && <image href={image} x={0} y={0} width={g.w} height={g.h} opacity={fade === 0 ? 0.9 : 0.35} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }} />}
            {!image && <rect x={0} y={0} width={g.w} height={g.h} fill="none" stroke="#2a2d2e" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {g.line.length >= 2 && (
              <path d={smoothPath(g.line, closed)} fill="none" stroke={TEAL} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            )}
            {g.pit && g.pit.line.length >= 2 && (
              <path d={smoothPath(g.pit.line, false)} fill="none" stroke="#cfd3d6" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
            )}
            {g.pit && closed && [g.pit.inU, g.pit.outU].map((u, i) => {
              const a = at(lap, u);
              return <g key={i} style={{ pointerEvents: "none" }}><circle cx={a.x} cy={a.y} r={px(4)} fill="#cfd3d6" />{labelAt(u, i === 0 ? "in" : "out", "#cfd3d6", 20)}</g>;
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
            {closed && turns.map((t) => (
              <g key={`t${t.n}`}>
                {labelAt(t.u, String(t.n), "#f0f0e8", 18)}
                {step === 4 && (
                  <g onPointerDown={(e) => startDrag(e, { kind: "turn", i: g.turns.indexOf(t.u) })} style={{ cursor: "grab" }}>
                    <circle cx={at(lap, t.u).x} cy={at(lap, t.u).y} r={px(9)} fill="transparent" />
                    <circle cx={at(lap, t.u).x} cy={at(lap, t.u).y} r={px(4)} fill={sel?.kind === "turn" && g.turns[sel.i] === t.u ? "#f0f0e8" : TEAL} />
                  </g>
                )}
              </g>
            ))}
            {closed && g.splits.map((s, i) => {
              const selected = sel?.kind === "split" && sel.i === i;
              const idx = segs.findIndex((q) => q.id === s.id);
              return (
                <g key={s.id}>
                  {tick(s.u, selected ? "#f0f0e8" : YELLOW, 9)}
                  {step === 5 && labelAt(s.u, segs[idx]?.name ?? "", YELLOW, 24)}
                  {step === 5 && (
                    <g onPointerDown={(e) => startDrag(e, { kind: "split", i })} style={{ cursor: "grab" }}>
                      <circle cx={at(lap, s.u).x} cy={at(lap, s.u).y} r={px(9)} fill="transparent" />
                    </g>
                  )}
                </g>
              );
            })}
            {step === 1 && g.line.map((p, i) => handle(p, `p${i}`, sel?.kind === "pt" && sel.i === i, (e) => startDrag(e, { kind: "pt", i })))}
            {step === 2 && g.line.map((p, i) => handle(p, `q${i}`, false, (e) => e.stopPropagation(), true))}
            {step === 2 && g.pit?.line.map((p, i) => handle(p, `pit${i}`, sel?.kind === "pit" && sel.i === i, (e) => startDrag(e, { kind: "pit", i })))}
          </svg>
        </div>

        <div className="r-stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <input className="r-field" placeholder="Track name" aria-label="Track name" maxLength={60} value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          <div className="r-section"><span>Step</span></div>
          {STEPS.map((s, i) => btn(`${i + 1} ${s}`, () => { setStep(i as Step); setSel(null); }, { pressed: step === i, disabled: i > 1 && g.line.length < 3 && !closed }))}
          <div className="r-section"><span>{STEPS[step]}</span></div>
          {step === 0 && (
            <>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { importImage(e.target.files?.[0]); e.target.value = ""; }} />
              {row(btn(image ? "Replace image" : "Import image", () => file.current?.click()), btn("Remove image", () => { setImage(null); setDirty(true); }, { disabled: !image }))}
            </>
          )}
          {step === 1 && (
            <>
              {row(btn("Delete point", remove, { disabled: sel?.kind !== "pt" }), btn("Sharp corner", toggleSharp, { pressed: sel?.kind === "pt" && !!g.line[sel.i]?.sharp, disabled: sel?.kind !== "pt" }))}
              {row(btn("Close loop", closeLoop, { disabled: closed || g.line.length < 3 }), btn("Clear lap", () => commit({ ...g, line: [], turns: [], splits: [], pit: null }, false), { disabled: g.line.length === 0 }))}
            </>
          )}
          {step === 2 && (
            <>
              {row(btn("Add point", () => setPitTool("add"), { pressed: pitTool === "add" }), btn("Delete point", remove, { disabled: sel?.kind !== "pit" }))}
              {row(btn("Set entry", () => setPitTool("entry"), { pressed: pitTool === "entry", disabled: !g.pit }), btn("Set exit", () => setPitTool("exit"), { pressed: pitTool === "exit", disabled: !g.pit }))}
              {row(btn("Sharp corner", toggleSharp, { disabled: sel?.kind !== "pit" }), btn("Clear pit lane", () => { commit({ ...g, pit: null }); setSel(null); }, { disabled: !g.pit }))}
            </>
          )}
          {step === 3 && (
            <>
              {row(btn("Clockwise", () => chooseDirection("cw"), { pressed: g.direction === "cw" }), btn("Counter-clockwise", () => chooseDirection("ccw"), { pressed: g.direction === "ccw" }))}
            </>
          )}
          {step === 4 && (
            <>
              {row(btn("Remove turn", remove, { disabled: sel?.kind !== "turn" }), btn("Clear turns", () => commit({ ...g, turns: [] }), { disabled: g.turns.length === 0 }))}
            </>
          )}
          {step === 5 && (
            <>
              {row(btn("Remove split", remove, { disabled: sel?.kind !== "split" }), btn("From turns", defaultSegments, { disabled: g.turns.length < 2 }))}
              {btn("Clear splits", () => commit({ ...g, splits: [] }), { disabled: g.splits.length === 0 })}
            </>
          )}
          {needsLine && <div className="r-text">Close the loop in Trace first.</div>}
        </div>
      </div>
    </Dialog>
  );
}
