import assert from "node:assert/strict";
import { test } from "node:test";
import { at, autoSplits, layoutLabels, placeLabels, CHAR_EM, withLine, drawnDirection, emptyGeometry, lapT, nearest, sample, segmentLabel, segmentsOf, setDirection, slice, turnsOf, validateGeometry, MAX_POIS, type TrackGeometry } from "../shared/track.ts";

// A square-ish loop drawn clockwise on screen (y down): top, right, bottom, left.
const square = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 300 },
  { x: 100, y: 300 },
];

const geo = (over: Partial<TrackGeometry> = {}): TrackGeometry => ({ ...emptyGeometry(1000, 600), line: square, direction: "cw", ...over });

test("sampling gives a length, and at and nearest agree", () => {
  const s = sample(square, true);
  assert.ok(s.len > 700 && s.len < 900);
  const p = at(s, 0.37);
  const n = nearest(s, p.x, p.y);
  assert.ok(Math.abs(n.u - 0.37) < 0.002);
  assert.ok(n.dist < 0.5);
  // Positions wrap around the lap.
  assert.deepEqual([at(s, 1.25).x, at(s, 1.25).y].map(Math.round), [at(s, 0.25).x, at(s, 0.25).y].map(Math.round));
});

test("a sharp point keeps its corner", () => {
  const sharp = sample(square.map((p) => ({ ...p, sharp: true })), true);
  const soft = sample(square, true);
  // Corners reach the control point only when sharp.
  const near = (s: ReturnType<typeof sample>) => Math.min(...s.pts.map(([x, y]) => Math.hypot(x - 300, y - 100)));
  assert.ok(near(sharp) < 0.01);
  assert.ok(near(soft) < 0.01); // every curve passes through its points
  const cut = (s: ReturnType<typeof sample>) => Math.min(...s.pts.map(([x, y]) => Math.hypot(x - 320, y - 80)));
  assert.ok(cut(sharp) > cut(soft) - 1);
});

test("drawn direction follows the winding on screen", () => {
  assert.equal(drawnDirection(square), "cw");
  assert.equal(drawnDirection([...square].reverse()), "ccw");
});

test("setDirection reverses the line and keeps turns and splits on the circuit", () => {
  const g = geo({ start: 0.1, turns: [0.2, 0.6], splits: [{ id: "a", u: 0.3 }, { id: "b", u: 0.8 }] });
  const ccw = setDirection(g, "ccw");
  assert.equal(ccw.direction, "ccw");
  assert.equal(drawnDirection(ccw.line), "ccw");
  const s = sample(g.line, true);
  const r = sample(ccw.line, true);
  // The same point of the circuit, reached by the flipped position.
  const a = at(s, 0.2);
  const b = at(r, 1 - 0.2);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1);
  assert.ok(Math.abs(ccw.start - 0.9) < 1e-9);
  // Setting the way it already runs changes nothing; two flips come back.
  assert.equal(setDirection(g, "cw"), g);
  const back = setDirection(ccw, "cw");
  assert.deepEqual(back.line, g.line);
  assert.ok(Math.abs(back.start - g.start) < 1e-9);
});

test("turns are numbered from the finish line in lap order", () => {
  const g = geo({ start: 0.5, turns: [0.1, 0.55, 0.9] });
  assert.deepEqual(turnsOf(g), [{ n: 1, u: 0.55 }, { n: 2, u: 0.9 }, { n: 3, u: 0.1 }]);
  assert.ok(Math.abs(lapT(g, 0.1) - 0.6) < 1e-9);
});

test("segments run between splits in lap order, with the pit lane last", () => {
  const g = geo({ start: 0.5, splits: [{ id: "x", u: 0.1 }, { id: "y", u: 0.6 }, { id: "z", u: 0.9 }], pit: { line: [{ x: 1, y: 1 }, { x: 2, y: 2 }], inU: 0.45, outU: 0.55 } });
  const segs = segmentsOf(g);
  assert.deepEqual(segs.map((s) => [s.id, s.name]), [["y", "S1"], ["z", "S2"], ["x", "S3"], ["pit", "PIT"]]);
  // S3 runs from 0.1 round to 0.6, across the finish line at 0.5? No: it ends at y.
  assert.equal(segs[2].to, 0.6);
  assert.equal(segs[1].to, 0.1);
});

test("segment labels name the turns inside", () => {
  const g = geo({ start: 0, turns: [0.1, 0.2, 0.3, 0.7], splits: [{ id: "a", u: 0.05 }, { id: "b", u: 0.25 }, { id: "c", u: 0.5 }] });
  const [s1, s2, s3] = segmentsOf(g);
  assert.equal(segmentLabel(g, s1), "turns 1 to 2");
  assert.equal(segmentLabel(g, s2), "turn 3");
  assert.equal(segmentLabel(g, s3), "turn 4"); // c to a wraps past 0.7
});

test("default splits sit halfway between turns", () => {
  const g = geo({ turns: [0.1, 0.3, 0.7] });
  const ids = ["a", "b", "c"];
  const sp = autoSplits(g, () => ids.shift()!);
  assert.deepEqual(sp.map((s) => Math.round(s.u * 1000) / 1000), [0.2, 0.5, 0.9]);
  assert.deepEqual(autoSplits(geo({ turns: [0.1] })), []);
});

test("slice follows the line across the start of the lap", () => {
  const s = sample(square, true);
  const pts = slice(s, 0.9, 0.1);
  const first = pts[0];
  const last = pts[pts.length - 1];
  assert.ok(Math.abs(first[0] - at(s, 0.9).x) < 0.01);
  assert.ok(Math.abs(last[0] - at(s, 0.1).x) < 0.01);
  assert.ok(pts.length > 10);
});

test("validation accepts a clean track and rejects garbage", () => {
  const g = geo({ turns: [0.2], splits: [{ id: "ab1", u: 0.4 }] });
  assert.deepEqual(validateGeometry(JSON.parse(JSON.stringify(g))), g);
  assert.equal(validateGeometry(null), null);
  assert.equal(validateGeometry({ ...g, line: g.line.slice(0, 2) }), null);
  assert.equal(validateGeometry({ ...g, direction: "up" }), null);
  assert.equal(validateGeometry({ ...g, start: 2 }), null);
  assert.equal(validateGeometry({ ...g, splits: [{ id: "pit", u: 0.1 }] }), null);
  assert.equal(validateGeometry({ ...g, splits: [{ id: "a", u: 0.1 }, { id: "a", u: 0.2 }] }), null);
  assert.equal(validateGeometry({ ...g, line: [{ x: NaN, y: 0 }, ...g.line] }), null);
  assert.equal(validateGeometry({ ...g, line: Array.from({ length: 401 }, () => ({ x: 1, y: 1 })) }), null);
  assert.equal(validateGeometry({ ...g, pit: { line: [{ x: 1, y: 1 }], inU: 0.1, outU: 0.2 } }), null);
});

test("changing the line keeps turns and splits at the same places on the circuit", () => {
  const g = geo({ start: 0.05, turns: [0.3], splits: [{ id: "a", u: 0.6 }] });
  // Add a point on the curve: the line is parameterised differently, so the same fraction would be a different place.
  const mid = at(sample(square, true), 0.375);
  const line = [square[0], square[1], { x: mid.x, y: mid.y }, square[2], square[3]];
  const n = withLine(g, line);
  const before = at(sample(g.line, true), 0.3);
  const after = at(sample(n.line, true), n.turns[0]);
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 12);
  const sb = at(sample(g.line, true), 0.6);
  const sa = at(sample(n.line, true), n.splits[0].u);
  assert.ok(Math.hypot(sb.x - sa.x, sb.y - sa.y) < 12);
  assert.equal(n.splits[0].id, "a");
});

test("labels that would overlap are moved apart, labels that fit stay put", () => {
  const spot = (x: number, y: number) => ({ x, y, nx: 0, ny: -1, w: 10 });
  const far = placeLabels([spot(0, 100), spot(200, 100)], { h: 16, base: 15, step: 16 });
  assert.deepEqual(far.map((p) => p.d), [15, 15]);
  const near = placeLabels([spot(0, 100), spot(4, 100), spot(8, 100)], { h: 16, base: 15, step: 16 });
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      assert.ok(Math.abs(near[i].x - near[j].x) >= 10 || Math.abs(near[i].y - near[j].y) >= 16, `labels ${i} and ${j} overlap`);
    }
  }
  assert.equal(near[0].d, 15);
  assert.ok(near[1].y > 100); // the second goes to the inner side
});

test("points of interest are cleaned, capped and optional", () => {
  const g = geo();
  const ok = validateGeometry({ ...g, pois: [{ id: "a1", x: 10.04, y: 20, label: "  lake " }, { id: "b2", x: 5, y: 5, label: "   " }] });
  assert.deepEqual(ok?.pois, [{ id: "a1", x: 10, y: 20, label: "LAKE" }]);
  assert.equal(validateGeometry(g)?.pois, undefined);
  assert.equal(validateGeometry({ ...g, pois: Array.from({ length: MAX_POIS + 1 }, (_, i) => ({ id: `p${i}`, x: 1, y: 1, label: "X" })) }), null);
  assert.equal(validateGeometry({ ...g, pois: [{ id: "BAD ID", x: 1, y: 1, label: "X" }] }), null);
  assert.equal(validateGeometry({ ...g, pois: "no" }), null);
});

test("a point of interest's label keeps clear of the track and of turn numbers", () => {
  const g = geo({ turns: [0.1, 0.35], pois: [{ id: "a", x: 150, y: 120, label: "LAKE" }, { id: "b", x: 250, y: 90, label: "CITY" }] });
  const lap = sample(g.line, true);
  const fs = 12;
  const L = layoutLabels(g, lap, null, { cx: 200, cy: 200, k: 1, fs, bounds: { x0: 0, y0: 0, x1: 400, y1: 400 } });
  const w = (label: string) => label.length * fs * CHAR_EM;
  const box = (p: (typeof L.pois)[number]) => ({ x: p.anchor === "start" ? p.tx + w(p.label) / 2 : p.anchor === "end" ? p.tx - w(p.label) / 2 : p.tx, y: p.ty, w: w(p.label), h: fs });
  for (const p of L.pois) {
    const b = box(p);
    assert.ok(!lap.pts.some(([x, y]) => Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2), `${p.label} sits on the track`);
    for (const t of L.turns) assert.ok(Math.abs(t.x - b.x) >= (b.w + fs * 0.6) / 2 || Math.abs(t.y - b.y) >= fs, `${p.label} overlaps turn ${t.n}`);
  }
  const [a, b] = L.pois.map(box);
  assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= fs, "the two labels overlap");
});
