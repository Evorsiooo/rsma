import assert from "node:assert/strict";
import { test } from "node:test";
import { computeGrid, qualifyingOf } from "../shared/grid.ts";
import type { Row } from "../shared/race.ts";

const row = (name: string, ms: number, entry?: string, over: Partial<Row> = {}): Row => ({ id: name + ms, name, status: "finished", penaltyMs: 0, rawMs: ms, finalMs: ms, entry, number: entry ? "7" : undefined, teamName: "Apex", car: entry ? "GT3" : undefined, ...over }) as Row;

test("a car's place is its fastest driver's time, and cars are ordered by it", () => {
  const g = computeGrid([row("A", 90_000, "c1"), row("B", 88_000, "c1"), row("C", 89_000, "c2"), row("D", 95_000)], null);
  assert.deepEqual(g.map((r) => [r.position, r.driver, r.ms]), [[1, "B", 88_000], [2, "C", 89_000], [3, "D", 95_000]]);
  assert.deepEqual(g[0].skipped, []);
});

test("when the fastest driver is absent the car uses its next fastest present driver", () => {
  const g = computeGrid([row("A", 90_000, "c1"), row("B", 88_000, "c1"), row("C", 89_000, "c2")], new Set(["a", "c"]));
  assert.deepEqual(g.map((r) => [r.position, r.driver, r.ms]), [[1, "C", 89_000], [2, "A", 90_000]]);
  assert.deepEqual(g[1].skipped, ["B"]);
});

test("a car with nobody present who set a time is left off, and unfinished runs do not count", () => {
  const g = computeGrid([row("A", 90_000, "c1"), row("B", 80_000, "c2", { status: "dnf", finalMs: undefined }), row("C", 91_000, "c2")], new Set(["b"]));
  assert.deepEqual(g, []);
});

test("the qualifying session: the one named, else the latest timed event before the race, else none", () => {
  const s = [{ id: "p", type: "practice" as const, startsAt: 1 }, { id: "t1", type: "timed" as const, startsAt: 2 }, { id: "t2", type: "timed" as const, startsAt: 3 }, { id: "r", type: "race" as const, startsAt: 4 }];
  assert.equal(qualifyingOf({ id: "r", startsAt: 4, qualifyingSession: null }, s), "t2");
  assert.equal(qualifyingOf({ id: "r", startsAt: 4, qualifyingSession: "t1" }, s), "t1");
  assert.equal(qualifyingOf({ id: "r", startsAt: 4, qualifyingSession: "none" }, s), null);
  assert.equal(qualifyingOf({ id: "t1", startsAt: 2, qualifyingSession: null }, s), null);
  assert.equal(qualifyingOf({ id: "r", startsAt: 4, qualifyingSession: "gone" }, s), null);
});

test("a car's other finished runs are folded under its row until opened", async () => {
  const { classify, foldCars } = await import("../shared/race.ts");
  const runs = [row("A", 90_000, "c1"), row("B", 88_000, "c1"), row("C", 89_000, "c2"), row("D", 95_000, "c1", { status: "queued", finalMs: undefined, rawMs: undefined })] as never;
  const rows = classify(runs);
  const closed = foldCars(rows, new Set());
  assert.deepEqual(closed.rows.map((r) => r.name), ["B", "C", "D"]);
  assert.equal(closed.hidden.get("c1"), 1);
  assert.deepEqual(foldCars(rows, new Set(["c1"])).rows.map((r) => r.name), ["B", "A", "C", "D"]);
});
