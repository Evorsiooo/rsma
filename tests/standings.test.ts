import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStandings, DEFAULT_CONFIG, eventPoints, eventProblem, fmtPoints, parseGap, parseTime, type ChampEvent, type ResultRow } from "../shared/standings.ts";

const row = (position: number, username: string, extra: Partial<ResultRow> = {}): ResultRow => ({ position, username, teamId: null, teamName: null, timeMs: null, gapMs: null, ...extra });
const ev = (id: string, heldAt: number, results: ResultRow[], extra: Partial<ChampEvent> = {}): ChampEvent => ({ id, name: id, heldAt, half: false, mode: "position", windowMs: null, results, ...extra });
const cfg = { points: [25, 18, 15], windowMs: 50 };

test("positions score from the table, places past it score nothing", () => {
  const e = ev("a", 1, [row(1, "aaa"), row(2, "bbb"), row(3, "ccc"), row(4, "ddd")]);
  assert.deepEqual(eventPoints(e, cfg), [25, 18, 15, 0]);
});

test("half points halve every score", () => {
  const e = ev("a", 1, [row(1, "aaa"), row(2, "bbb"), row(3, "ccc")], { half: true });
  assert.deepEqual(eventPoints(e, cfg), [12.5, 9, 7.5]);
  assert.equal(fmtPoints(12.5), "12.5");
  assert.equal(fmtPoints(9), "9");
});

test("window mode: a car within the first window scores the winner's points", () => {
  const e = ev("t", 1, [row(1, "aaa", { timeMs: 60_000 }), row(2, "bbb", { timeMs: 60_010 }), row(3, "ccc", { timeMs: 60_049 }), row(4, "ddd", { timeMs: 60_050 }), row(5, "eee", { timeMs: 60_260 })], { mode: "window" });
  assert.deepEqual(eventPoints(e, cfg), [25, 25, 25, 18, 0]);
});

test("window mode: the event's own window width wins over the default", () => {
  const e = ev("t", 1, [row(1, "aaa", { timeMs: 60_000 }), row(2, "bbb", { timeMs: 60_150 }), row(3, "ccc", { timeMs: 60_400 })], { mode: "window", windowMs: 200 });
  assert.deepEqual(eventPoints(e, cfg), [25, 25, 15]);
});

test("window mode works from intervals when times are missing", () => {
  const e = ev("t", 1, [row(1, "aaa"), row(2, "bbb", { gapMs: 20 }), row(3, "ccc", { gapMs: 40 }), row(4, "ddd", { gapMs: 5 })], { mode: "window" });
  assert.deepEqual(eventPoints(e, cfg), [25, 25, 18, 18]);
});

test("window mode needs times or intervals", () => {
  const e = ev("t", 1, [row(1, "aaa"), row(2, "bbb")], { mode: "window" });
  assert.match(eventProblem(e) ?? "", /Windows need/);
  assert.equal(eventProblem({ ...e, mode: "position" }), null);
});

test("standings sum drivers and teams, and split ties by wins", () => {
  const t = (n: string) => ({ teamId: null, teamName: n });
  const events = [
    ev("r2", 2, [row(1, "bbb", t("Blue")), row(2, "aaa", t("Red")), row(3, "ccc", t("Red"))]),
    ev("r1", 1, [row(1, "aaa", t("Red")), row(2, "bbb", t("Blue")), row(3, "ccc", t("Red"))]),
  ];
  const s = computeStandings(events, cfg);
  assert.deepEqual(s.rounds.map((r) => r.id), ["r1", "r2"]);
  // aaa 25+18 = 43, bbb 18+25 = 43: one win each, one second each, so name decides
  assert.deepEqual(s.drivers.map((d) => [d.name, d.points]), [["aaa", 43], ["bbb", 43], ["ccc", 30]]);
  assert.deepEqual(s.teams.map((d) => [d.name, d.points]), [["Red", 73], ["Blue", 43]]);
  assert.equal(s.drivers[0].cells[1]?.position, 2);
});

test("a win breaks a tie in points", () => {
  const events = [ev("r1", 1, [row(1, "aaa"), row(2, "bbb"), row(3, "ccc")]), ev("r2", 2, [row(1, "xxx"), row(2, "bbb"), row(3, "aaa")])];
  const s = computeStandings(events, { points: [10, 5, 0], windowMs: 50 });
  assert.deepEqual(s.drivers.map((d) => [d.name, d.points]), [["aaa", 10], ["xxx", 10], ["bbb", 10], ["ccc", 0]]);
});

test("event validation", () => {
  assert.match(eventProblem(ev("a", 1, [row(1, "ab")])) ?? "", /not a Roblox/);
  assert.match(eventProblem(ev("a", 1, [row(1, "aaa"), row(2, "AAA")])) ?? "", /twice/);
  assert.match(eventProblem(ev("a", 1, [])) ?? "", /at least one/);
});

test("parsing times and intervals", () => {
  assert.equal(parseTime("1:23.456"), 83_456);
  assert.equal(parseTime("83.4"), 83_400);
  assert.equal(parseTime("01:02"), 62_000);
  assert.equal(parseTime("1:75.0"), null);
  assert.equal(parseTime("abc"), null);
  assert.equal(parseGap("+0.250"), 250);
  assert.equal(parseGap("0,25"), 250);
});
