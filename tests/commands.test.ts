import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, type Command } from "../shared/commands.ts";
import { classify, emptyState, viewFor, type RaceState } from "../shared/race.ts";

let n = 0;
const ctx = (now: number) => ({ now, actor: "tester", newId: () => `id${++n}` });
function run(s: RaceState, cmd: Command, now: number): RaceState {
  const r = applyCommand(s, cmd, ctx(now));
  assert.ok("state" in r, `expected ok, got ${JSON.stringify(r)}`);
  return r.state;
}
const fails = (s: RaceState, cmd: Command, now: number) => {
  const r = applyCommand(s, cmd, ctx(now));
  assert.ok("error" in r);
  return r.error;
};

test("queue, go, finish ranks by raw time", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "alpha", plate: "a-1" }, 0);
  s = run(s, { type: "add", name: "bravo", plate: "b-2" }, 0);
  assert.equal(s.runs[0].plate, "A-1");
  s = run(s, { type: "go" }, 1000); // alpha starts at 4000
  s = run(s, { type: "go" }, 2000); // bravo starts at 5000
  assert.equal(fails(s, { type: "finish", runId: s.runs[0].id }, 3000), "not_running"); // still counting down
  s = run(s, { type: "finish" }, 64000); // oldest = alpha, 60s
  assert.equal(s.runs[0].rawMs, 60000);
  s = run(s, { type: "finish" }, 70000); // bravo, 65s
  assert.equal(s.runs[1].rawMs, 65000);
  assert.deepEqual(classify(s.runs).map((r) => r.name), ["alpha", "bravo"]);
});

test("penalties change the ranking and can be removed", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "alpha", plate: "A" }, 0);
  s = run(s, { type: "add", name: "bravo", plate: "B" }, 0);
  s = run(s, { type: "go" }, 0);
  s = run(s, { type: "go" }, 0);
  s = run(s, { type: "finish" }, 63000); // alpha 60s
  s = run(s, { type: "finish" }, 66000); // bravo 63s
  const [a, b] = s.runs;
  s = run(s, { type: "penalty", runId: a.id, ruleId: "track-limit", delta: 1 }, 70000);
  assert.equal(s.runs[0].penaltyMs, 5000);
  s = run(s, { type: "penalty", runId: a.id, ruleId: "jump-start", delta: 1 }, 70000);
  assert.deepEqual(classify(s.runs).map((r) => r.name), ["bravo", "alpha"]); // 63 < 75
  s = run(s, { type: "penalty", runId: a.id, ruleId: "jump-start", delta: -1 }, 70000);
  assert.equal(s.runs[0].penaltyMs, 5000);
  assert.equal(fails(s, { type: "penalty", runId: b.id, ruleId: "jump-start", delta: -1 }, 0), "not_found");
});

test("editing a rule does not change penalties already applied", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "alpha", plate: "A" }, 0);
  s = run(s, { type: "go" }, 0);
  const id = s.runs[0].id;
  s = run(s, { type: "penalty", runId: id, ruleId: "track-limit", delta: 1 }, 5000);
  s = run(s, { type: "ruleSet", id: "track-limit", seconds: 20 }, 5000);
  assert.equal(s.runs[0].penaltyMs, 5000);
  s = run(s, { type: "penalty", runId: id, ruleId: "track-limit", delta: 1 }, 5000);
  assert.equal(s.runs[0].penaltyMs, 25000);
});

test("a finish with nobody running is held, then assigned", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "alpha", plate: "A" }, 0);
  s = run(s, { type: "go" }, 0); // starts at 3000
  s = run(s, { type: "finish" }, 2000); // before the start: not running yet
  assert.deepEqual(s.pending, [2000]);
  assert.equal(fails(s, { type: "assign", ts: 2000, runId: s.runs[0].id }, 5000), "not_running");
  s = run(s, { type: "finish" }, 10000);
  assert.equal(s.runs[0].status, "finished");
  s = run(s, { type: "discard", ts: 2000 }, 11000);
  assert.deepEqual(s.pending, []);
});

test("dnf, remove, move and reset", () => {
  let s = emptyState();
  for (const nm of ["a", "b", "c"]) s = run(s, { type: "add", name: nm, plate: nm }, 0);
  s = run(s, { type: "move", runId: s.runs[2].id, dir: -1 }, 0);
  assert.deepEqual(s.runs.map((r) => r.name), ["a", "c", "b"]);
  assert.equal(fails(s, { type: "move", runId: s.runs[0].id, dir: -1 }, 0), "invalid");
  s = run(s, { type: "go" }, 0);
  assert.equal(fails(s, { type: "remove", runId: s.runs[0].id }, 0), "not_queued");
  s = run(s, { type: "dnf", runId: s.runs[0].id }, 5000);
  assert.equal(s.runs[0].status, "dnf");
  s = run(s, { type: "radio", to: "all", text: "hold" }, 5000);
  s = run(s, { type: "reset" }, 6000);
  assert.deepEqual(s.runs.map((r) => r.name), ["c", "b"]);
  assert.equal(s.radio.length, 0);
});

test("validation and immutability", () => {
  const s = emptyState();
  assert.equal(fails(s, { type: "add", name: " ", plate: "x" }, 0), "invalid");
  assert.equal(fails(s, { type: "go" }, 0), "no_queue");
  assert.equal(fails(s, { type: "radio", to: ["nope"], text: "x" }, 0), "invalid");
  assert.equal(fails(s, { type: "ruleAdd", name: "x", seconds: -1 }, 0), "invalid");
  assert.equal(fails(s, { type: "cadence", sec: 1 }, 0), "invalid");
  const before = JSON.stringify(s);
  run(s, { type: "flag", flag: "red" }, 0);
  assert.equal(JSON.stringify(s), before);
});

const msgs = (s: RaceState, runId: string) => s.radio.filter((m) => m.to !== "all" && m.to !== "team" && m.to.includes(runId)).map((m) => m.text);

test("driver gets radio for penalty, finish position and position changes", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "alpha", plate: "a" }, 0);
  s = run(s, { type: "add", name: "bravo", plate: "b" }, 0);
  const [a, b] = s.runs.map((r) => r.id);
  s = run(s, { type: "go" }, 1000); // alpha starts 4000
  s = run(s, { type: "go" }, 2000); // bravo starts 5000
  s = run(s, { type: "finish", runId: a }, 64000); // alpha 60.000
  assert.match(msgs(s, a)[0], /Finished\. Time 01:00\.000\. Position P1\./);
  s = run(s, { type: "finish", runId: b }, 62000); // bravo 57.000, ahead of alpha
  assert.match(msgs(s, b)[0], /Position P1\./);
  assert.deepEqual(msgs(s, a).slice(1), ["Position now P2."]);
  s = run(s, { type: "penalty", runId: b, ruleId: "track-limit", delta: 1 }, 70000); // bravo 62.000, now behind alpha
  assert.match(msgs(s, b).at(-2)!, /Penalty \+5\.000: Track limit/);
  assert.equal(msgs(s, b).at(-1), "Position now P2.");
  assert.equal(msgs(s, a).at(-1), "Position now P1.");
  s = run(s, { type: "penalty", runId: b, ruleId: "jump-start", delta: 1 }, 71000); // still P2: penalty message only
  assert.match(msgs(s, b).at(-1)!, /Penalty \+10\.000: Jump start/);
});

test("flag changes are announced to all, once", () => {
  let s = emptyState();
  s = run(s, { type: "flag", flag: "yellow" }, 1);
  s = run(s, { type: "flag", flag: "yellow" }, 2);
  assert.deepEqual(s.radio.map((m) => [m.to, m.text]), [["all", "Yellow flag."]]);
});

test("radio is only visible to signed-in viewers it is addressed to", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "Alpha", plate: "a", team: { id: "t1", name: "Red" } }, 0);
  s = run(s, { type: "add", name: "Bravo", plate: "b", team: { id: "t2", name: "Blue" } }, 0);
  s = run(s, { type: "radio", to: [s.runs[0].id], text: "private" }, 1);
  s = run(s, { type: "teamRadio", team: "t1", teamName: "Red", text: "red only" }, 2);
  s = run(s, { type: "radio", to: "all", text: "everyone" }, 3);
  const texts = (v: Parameters<typeof viewFor>[1]) => viewFor(s, v).radio.map((m) => m.text);
  assert.deepEqual(texts({ staff: false, teams: [] }), ["everyone"]); // the Public radio: Global only
  assert.deepEqual(texts({ staff: false, user: "alpha", teams: [] }), ["private", "red only", "everyone"]);
  assert.deepEqual(texts({ staff: false, user: "bravo", teams: [] }), ["everyone"]);
  assert.deepEqual(texts({ staff: false, user: "someone", teams: ["t1"] }), ["private", "red only", "everyone"]); // the team panel also sees messages to its drivers
  assert.equal(texts({ staff: true, teams: [] }).length, 3);
});

test("team to stewards and steward to teams reach only the right viewers", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "Alpha", plate: "a", team: { id: "t1", name: "Red" } }, 0);
  s = run(s, { type: "teamRadio", team: "t1", teamName: "Red", text: "to stewards", to: "stewards" }, 1);
  s = run(s, { type: "radioTeams", teams: [{ id: "t2", name: "Blue" }], text: "blue only" }, 2);
  const texts = (v: Parameters<typeof viewFor>[1]) => viewFor(s, v).radio.map((m) => m.text);
  assert.deepEqual(texts({ staff: false, user: "x", teams: ["t1"] }), ["to stewards"]);
  assert.deepEqual(texts({ staff: false, user: "x", teams: ["t2"] }), ["blue only"]);
  assert.deepEqual(texts({ staff: false, user: "alpha", teams: [] }), []); // a driver does not see their team's messages to stewards
  assert.deepEqual(texts({ staff: true, teams: [] }), ["to stewards", "blue only"]);
  // Messages to a driver are visible to that driver's team panel, not to other teams.
  s = run(s, { type: "radio", to: [s.runs[0].id], text: "to alpha" }, 3);
  assert.ok(texts({ staff: false, user: "x", teams: ["t1"] }).includes("to alpha"));
  assert.ok(!texts({ staff: false, user: "x", teams: ["t2"] }).includes("to alpha"));
});

test("notes are staff only and follow the driver by name", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "Alpha", plate: "a" }, 0);
  s = run(s, { type: "note", runId: s.runs[0].id, text: "cut the chicane" }, 1);
  assert.equal(s.notes[0].driver, "Alpha");
  assert.equal(viewFor(s, { staff: false, user: "alpha", teams: [] }).notes.length, 0);
  s = run(s, { type: "reset" }, 2);
  assert.equal(s.notes.length, 1);
  s = run(s, { type: "noteDel", id: s.notes[0].id }, 3);
  assert.equal(s.notes.length, 0);
});

test("pit windows are validated, ordered and visible to their team", () => {
  let s = emptyState();
  const base = { type: "pitAdd", team: "t1", teamName: "Red", lengthMs: 3600_000 } as const;
  assert.equal(fails(s, { ...base, fromMs: 600_000, toMs: 600_000 }, 1), "invalid");
  assert.equal(fails(s, { ...base, fromMs: 0, toMs: 4000_000 }, 1), "invalid");
  s = run(s, { ...base, fromMs: 1200_000, toMs: 1500_000 }, 1);
  s = run(s, { ...base, fromMs: 300_000, toMs: 600_000 }, 2);
  s = run(s, { type: "pitAdd", team: "t2", teamName: "Blue", fromMs: 0, toMs: 60_000, lengthMs: 3600_000 }, 3);
  assert.deepEqual(s.pitWindows.filter((w) => w.team === "t1").map((w) => w.fromMs), [300_000, 1200_000]);
  assert.equal(viewFor(s, { staff: false, user: "x", teams: ["t1"] }).pitWindows.length, 2);
  assert.equal(viewFor(s, { staff: false, teams: [] }).pitWindows.length, 0);
  assert.equal(fails(s, { type: "pitDel", team: "t1", id: s.pitWindows.find((w) => w.team === "t2")!.id }, 4), "not_found"); // another team's window
});

test("self-timed: a team starts and stops only its own cars, and times can be deleted", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "ann", plate: "a-1", team: { id: "t1", name: "Red" } }, 0);
  s = run(s, { type: "add", name: "bob", plate: "b-1", team: { id: "t2", name: "Blue" } }, 0);
  s = run(s, { type: "teamGo", team: "t2" }, 1000);
  assert.equal(s.runs[0].status, "queued");
  assert.equal(s.runs[1].status, "onstage");
  assert.equal(fails(s, { type: "teamFinish", team: "t1" }, 9000), "not_running");
  s = run(s, { type: "teamFinish", team: "t2" }, 31000);
  assert.equal(s.runs[1].rawMs, 27000);
  assert.equal(fails(s, { type: "delRun", runId: s.runs[0].id }, 32000), "not_finished");
  s = run(s, { type: "delRun", runId: s.runs[1].id }, 33000);
  assert.equal(s.runs.length, 1);
});

test("team asks a driver, the driver answers, and chat reaches the team", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "Ann", plate: "a-1", team: { id: "t1", name: "Red" } }, 0);
  s = run(s, { type: "add", name: "bob", plate: "b-1", team: { id: "t2", name: "Blue" } }, 0);
  assert.equal(fails(s, { type: "ask", team: "t2", teamName: "Blue", driver: "ann", text: "Box?" }, 10), "invalid"); // not their driver
  assert.equal(fails(s, { type: "ask", team: "t1", teamName: "Red", driver: "ann", text: "Box?", options: ["one"] }, 10), "invalid");
  s = run(s, { type: "ask", team: "t1", teamName: "Red", driver: "ann", text: "Box?" }, 10);
  const q = s.radio[0];
  assert.deepEqual(q.ask?.options, ["Yes", "No"]);
  assert.ok(viewFor(s, { staff: false, user: "ann", teams: [] }).radio.some((m) => m.id === q.id));
  assert.ok(!viewFor(s, { staff: false, user: "bob", teams: [] }).radio.some((m) => m.id === q.id));
  assert.equal(applyCommand(s, { type: "answer", msgId: q.id, index: 0 }, { ...ctx(20), actor: "bob" }).hasOwnProperty("error"), true);
  const r = applyCommand(s, { type: "answer", msgId: q.id, index: 1 }, { ...ctx(20), actor: "Ann" });
  assert.ok("state" in r);
  s = r.state;
  assert.equal(s.radio[0].ask?.answered?.index, 1);
  assert.equal(s.radio[1].tone, "red");
  assert.ok(viewFor(s, { staff: false, teams: ["t1"], user: "x" }).radio.some((m) => m.to === "team"));
  const c = applyCommand(s, { type: "driverRadio", text: "Tyres gone" }, { ...ctx(30), actor: "ann" });
  assert.ok("state" in c && c.state.radio.at(-1)?.team === "t1");
  assert.ok("error" in applyCommand(s, { type: "driverRadio", text: "hi" }, { ...ctx(30), actor: "nobody" }));
});

test("a team reorders only its own queued cars; cars carry the team's car", () => {
  let s = emptyState();
  const red = { id: "t1", name: "Red", car: "GT3" };
  s = run(s, { type: "add", name: "r1", plate: "r-1", team: red }, 0);
  s = run(s, { type: "add", name: "b1", plate: "b-1", team: { id: "t2", name: "Blue" } }, 0);
  s = run(s, { type: "add", name: "r2", plate: "r-2", team: red }, 0);
  assert.equal(s.runs[0].car, "GT3");
  assert.equal(s.runs[1].car, undefined);
  s = run(s, { type: "teamMove", team: "t1", runId: s.runs[2].id, dir: -1 }, 1);
  assert.deepEqual(s.runs.map((r) => r.name), ["r2", "b1", "r1"]);
  assert.equal(fails(s, { type: "teamMove", team: "t1", runId: s.runs[1].id, dir: 1 }, 2), "not_found"); // Blue's car
  assert.equal(fails(s, { type: "teamMove", team: "t1", runId: s.runs[0].id, dir: -1 }, 2), "invalid"); // already first
});

test("attribute, unattribute and set times, with the team limits", () => {
  let s = emptyState();
  const red = { id: "t1", name: "Red" };
  s = run(s, { type: "add", name: "d1", plate: "a-1", team: red }, 0);
  s = run(s, { type: "add", name: "d2", plate: "a-2", team: red }, 0);
  s = run(s, { type: "add", name: "x", plate: "b-1", team: { id: "t2", name: "Blue" } }, 0);
  s = run(s, { type: "teamGo", team: "t1" }, 1000); // d1 starts at 4000
  s = run(s, { type: "teamGo", team: "t1" }, 2000); // d2 starts at 5000
  s = run(s, { type: "teamFinish", team: "t1" }, 30000); // stops d1 (oldest) by mistake: 26 s
  const d1 = s.runs[0];
  const d2 = s.runs[1];
  assert.equal(d1.rawMs, 26000);
  // the stop was really d2 passing: move the time to d2
  assert.equal(fails(s, { type: "reattribute", fromRunId: d1.id, runId: d2.id, team: "t2" }, 31000), "not_found");
  s = run(s, { type: "reattribute", fromRunId: d1.id, runId: d2.id, team: "t1" }, 31000);
  assert.equal(s.runs[0].status, "onstage");
  assert.equal(s.runs[1].rawMs, 25000);
  // or the stop was nobody's: remove it, then attribute it to d1 again
  s = run(s, { type: "unattribute", runId: d2.id, team: "t1" }, 32000);
  assert.deepEqual(s.pending, [30000]);
  assert.equal(fails(s, { type: "assign", ts: 30000, runId: d1.id, team: "t2" }, 33000), "forbidden");
  s = run(s, { type: "assign", ts: 30000, runId: d1.id, team: "t1" }, 33000);
  assert.equal(s.runs[0].rawMs, 26000);
  assert.deepEqual(s.pending, []);
  // DNF and manual times, own cars only
  assert.equal(fails(s, { type: "dnf", runId: s.runs[2].id, team: "t1" }, 34000), "not_found");
  s = run(s, { type: "dnf", runId: d2.id, team: "t1" }, 34000);
  assert.equal(s.runs[1].status, "dnf");
  assert.equal(fails(s, { type: "setTime", runId: d2.id, ms: 5, team: "t1" }, 35000), "invalid");
  s = run(s, { type: "setTime", runId: d2.id, ms: 83456, team: "t1" }, 35000);
  assert.equal(s.runs[1].status, "finished");
  assert.equal(s.runs[1].rawMs, 83456);
  s = run(s, { type: "setTime", runId: s.runs[2].id, ms: 90000 }, 36000); // a steward, queued car
  assert.equal(s.runs[2].status, "finished");
});

test("long run: laps are counted per car, the best lap is the time, the generic stop skips it", () => {
  let s = emptyState();
  const red = { id: "t1", name: "Red" };
  s = run(s, { type: "add", name: "lr", plate: "a-1", number: "7", team: red }, 0);
  s = run(s, { type: "add", name: "q", plate: "a-2", team: red }, 0);
  assert.equal(s.runs[0].number, "7");
  s = run(s, { type: "setMode", runId: s.runs[0].id, mode: "long", team: "t1" }, 10);
  s = run(s, { type: "teamGo", team: "t1" }, 1000); // lr starts at 4000
  s = run(s, { type: "teamGo", team: "t1" }, 2000); // q starts at 5000
  const lr = s.runs[0].id;
  s = run(s, { type: "lap", runId: lr, team: "t1" }, 64000); // 60 s
  assert.equal(fails(s, { type: "lap", runId: lr, team: "t1" }, 64300), "too_soon");
  s = run(s, { type: "lap", runId: lr, team: "t1" }, 120000); // 56 s
  s = run(s, { type: "teamFinish", team: "t1" }, 130000); // generic stop takes the quali car
  assert.equal(s.runs[1].status, "finished");
  assert.equal(s.runs[0].status, "onstage");
  assert.equal(fails(s, { type: "setMode", runId: lr, mode: "quali", team: "t1" }, 131000), "has_laps");
  s = run(s, { type: "teamFinish", team: "t1", runId: lr }, 170000); // last lap 50 s
  assert.deepEqual(s.runs[0].laps, [60000, 56000, 50000]);
  assert.equal(s.runs[0].rawMs, 50000);
  assert.equal(fails(s, { type: "unattribute", runId: lr }, 171000), "invalid");
});

test("editInfo sets plate and number, and rejects an empty plate", () => {
  let s = run(emptyState(), { type: "add", name: "alpha", plate: "P1" }, 0);
  const id = s.runs[0].id;
  s = run(s, { type: "editInfo", runId: id, plate: " ab-12 ", number: "7" }, 0);
  assert.equal(s.runs[0].plate, "AB-12");
  assert.equal(s.runs[0].number, "7");
  assert.equal(fails(s, { type: "editInfo", runId: id, plate: "  " }, 0), "invalid");
  assert.equal(fails(s, { type: "editInfo", runId: "nope", plate: "X" }, 0), "not_found");
});

test("public view only carries Global radio", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "alpha", plate: "A" }, 0);
  s = run(s, { type: "radio", to: "all", text: "everyone" }, 0);
  s = run(s, { type: "radio", to: [s.runs[0].id], text: "just alpha" }, 0);
  const pub = viewFor(s, { staff: false, teams: [] });
  assert.deepEqual(pub.radio.map((m) => m.text), ["everyone"]);
  assert.deepEqual(viewFor(s, { staff: false, teams: [], user: "alpha" }).radio.map((m) => m.text), ["everyone", "just alpha"]);
});

test("syncReg stages the registered drivers and follows the cut", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "Steward Added", plate: "ZZ 1" }, 500);
  s = run(s, { type: "syncReg", drivers: [{ name: "Ann", team: { id: "t1", name: "Red", car: "GT" } }, { name: "Bob" }] }, 1000);
  assert.deepEqual(s.runs.map((r) => [r.name, r.plate, r.teamName, r.car]), [["Steward Added", "ZZ 1", undefined, undefined], ["Ann", "", "Red", "GT"], ["Bob", "", undefined, undefined]]);
  assert.equal(fails(s, { type: "syncReg", drivers: [{ name: "ann" }, { name: "bob" }] }, 2000), "nothing_to_add");
  s = run(s, { type: "editInfo", runId: s.runs[1].id, plate: "ab 12", number: "7" }, 2500);
  s = run(s, { type: "syncReg", drivers: [{ name: "Cy" }] }, 3000);
  assert.deepEqual(s.runs.map((r) => r.name), ["Steward Added", "Cy"]);
});

test("team notes: own drivers only, kept apart from steward notes and private to that team", () => {
  let s = emptyState();
  s = run(s, { type: "add", name: "Ann", plate: "A1", team: { id: "t1", name: "Red" } }, 100);
  s = run(s, { type: "add", name: "Bob", plate: "B1", team: { id: "t2", name: "Blue" } }, 100);
  const [ann, bob] = s.runs;
  assert.equal(fails(s, { type: "teamNote", team: "t1", runId: bob.id, text: "not mine" }, 200), "not_found");
  assert.equal(fails(s, { type: "teamNote", team: "t1", runId: ann.id, text: "  " }, 200), "invalid");
  s = run(s, { type: "teamNote", team: "t1", runId: ann.id, text: "tyres worn" }, 300);
  s = run(s, { type: "note", runId: ann.id, text: "steward only" }, 400);
  s = run(s, { type: "teamNote", team: "t2", runId: bob.id, text: "blue note" }, 500);
  assert.deepEqual(viewFor(s, { staff: true, teams: [] }).notes.map((n) => n.text), ["tyres worn", "steward only", "blue note"]);
  assert.deepEqual(viewFor(s, { staff: false, teams: ["t1"], user: "x" }).notes.map((n) => n.text), ["tyres worn"]);
  assert.deepEqual(viewFor(s, { staff: false, teams: [] }).notes, []);
  assert.equal(fails(s, { type: "teamNoteDel", team: "t2", id: s.notes[0].id }, 600), "not_found");
  s = run(s, { type: "teamNoteDel", team: "t1", id: s.notes[0].id }, 700);
  assert.equal(s.notes.length, 2);
});
