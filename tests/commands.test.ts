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
  assert.deepEqual(texts({ staff: false, teams: [] }), []);
  assert.deepEqual(texts({ staff: false, user: "alpha", teams: [] }), ["private", "red only", "everyone"]);
  assert.deepEqual(texts({ staff: false, user: "bravo", teams: [] }), ["everyone"]);
  assert.deepEqual(texts({ staff: false, user: "someone", teams: ["t1"] }), ["red only", "everyone"]);
  assert.equal(texts({ staff: true, teams: [] }).length, 3);
});
