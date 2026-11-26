import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStandings, DEFAULT_CONFIG, eventPoints, eventProblem, fmtPoints, parseGap, parseTime, type ChampEvent, type ResultRow } from "../shared/standings.ts";

const row = (position: number, username: string, extra: Partial<ResultRow> = {}): ResultRow => ({ position, username, teamId: null, teamName: null, timeMs: null, gapMs: null, ...extra });
const ev = (id: string, heldAt: number, results: ResultRow[], extra: Partial<ChampEvent> = {}): ChampEvent => ({ id, name: id, heldAt, half: false, mode: "position", windowMs: null, results, ...extra });
const cfg = { points: [25, 18, 15], windowMs: 50 };
// Adrien's example: 1.5 s windows, points 16, 12, 10, ...

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
  assert.deepEqual(eventPoints(e, cfg), [25, 25, 25, 25, 0]);
});

test("window mode: the event's own window width wins over the default", () => {
  const e = ev("t", 1, [row(1, "aaa", { timeMs: 60_000 }), row(2, "bbb", { timeMs: 60_150 }), row(3, "ccc", { timeMs: 60_400 })], { mode: "window", windowMs: 200 });
  assert.deepEqual(eventPoints(e, cfg), [25, 25, 18]);
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

test("windows are consecutive bands from the fastest time, an empty band still uses its slot", () => {
  const c = { points: [16, 12, 10, 8, 6, 5, 4, 3, 2, 1], windowMs: 1500 };
  const t = (n: number) => 60_000 + n;
  const e = ev("t", 1, [row(1, "aaa", { timeMs: t(0) }), row(2, "bbb", { timeMs: t(700) }), row(3, "ccc", { timeMs: t(1500) }), row(4, "ddd", { timeMs: t(3200) }), row(5, "eee", { timeMs: t(4500) }), row(6, "fff", { timeMs: t(4501) })], { mode: "window" });
  // 3 within 1.5 s: 16 each. Nobody in 1.5-3 s, which uses up the 12. 2 within 3-4.5 s: 10 each. 4.5 s starts the next band.
  assert.deepEqual(eventPoints(e, c), [16, 16, 16, 10, 10, 8]);
});

test("a driver who raced for several teams: each result scores for its own team, the driver totals across teams", () => {
  const events = [
    ev("r1", 1, [row(1, "aaa", { teamName: "Red" }), row(2, "bbb", { teamName: "Blue" })]),
    ev("r2", 2, [row(1, "bbb", { teamName: "Red" }), row(2, "aaa", { teamName: "Blue" })]),
    ev("r3", 3, [row(1, "aaa")]),
  ];
  const s = computeStandings(events, cfg);
  assert.deepEqual(s.drivers.map((d) => [d.name, d.points, d.team]), [["aaa", 68, "Blue"], ["bbb", 43, "Red"]]);
  assert.deepEqual(s.teams.map((t) => [t.name, t.points]), [["Red", 50], ["Blue", 36]]);
});

test("a car's points are split equally between the drivers who drove it, once each however many stints", () => {
  const car = (position: number, name: string, drivers: string[], teamName: string) => row(position, drivers[0], { car: name, drivers: drivers.map((username) => ({ username })), teamId: null, teamName });
  const e = ev("e", 1, [car(1, "#1 A", ["aaa", "bbb", "aaa"], "Red"), car(2, "#2 B", ["ccc", "ddd", "eee"], "Blue")]);
  const c = { points: [25, 18], windowMs: 50 };
  const s = computeStandings([e], c);
  assert.deepEqual(s.drivers.map((d) => [d.name, d.points]), [["aaa", 12.5], ["bbb", 12.5], ["ccc", 6], ["ddd", 6], ["eee", 6]]);
  // The team gets the car's whole score.
  assert.deepEqual(s.teams.map((t) => [t.name, t.points]), [["Red", 25], ["Blue", 18]]);
  assert.equal(s.drivers[0].wins, 1);
});

test("a split that does not divide evenly is rounded to two decimals", () => {
  const e = ev("e", 1, [row(1, "aaa", { car: "#1", drivers: [{ username: "aaa" }, { username: "bbb" }, { username: "ccc" }] })]);
  const s = computeStandings([e], { points: [25], windowMs: 50 });
  assert.deepEqual(s.drivers.map((d) => d.points), [8.33, 8.33, 8.33]);
  assert.equal(fmtPoints(8.33), "8.33");
  assert.equal(fmtPoints(12.5), "12.5");
});

test("a driver cannot score in two result rows", () => {
  const e = ev("e", 1, [row(1, "aaa", { drivers: [{ username: "aaa" }, { username: "bbb" }] }), row(2, "ccc", { drivers: [{ username: "ccc" }, { username: "bbb" }] })]);
  assert.match(eventProblem(e) ?? "", /bbb is listed twice/);
  assert.equal(eventProblem({ ...e, results: [e.results[0]] }), null);
});
