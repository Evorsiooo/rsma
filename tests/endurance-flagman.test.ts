import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCommand, type Command } from "../shared/commands.ts";
import { classify, emptyState, releasable, viewFor, type RaceState } from "../shared/race.ts";

let n = 0;
const ctx = (now: number) => ({ now, actor: "tester", newId: () => `id${++n}` });
function run(s: RaceState, cmd: Command, now = 0): RaceState {
  const r = applyCommand(s, cmd, ctx(now));
  assert.ok("state" in r, `expected ok, got ${JSON.stringify(r)}`);
  return r.state;
}
const fails = (s: RaceState, cmd: Command, now = 0) => {
  const r = applyCommand(s, cmd, ctx(now));
  assert.ok("error" in r);
  return r.error;
};

const team = { id: "t1", name: "Red Team", car: "Chevrolet" };
const car7 = { id: "e7", number: "7", plate: "B-2" };
const car8 = { id: "e8", number: "8", plate: "B-3" };

function staged(): RaceState {
  return run(emptyState(), {
    type: "syncReg",
    drivers: [
      { name: "alpha", team, entry: car7 },
      { name: "kiri", team, entry: car7 },
      { name: "pigeon", team, entry: car7 },
      { name: "sunny", team, entry: car8 },
    ],
  });
}
const byName = (s: RaceState, name: string) => s.runs.find((r) => r.name === name)!;

test("syncReg stages drivers into their car with its number and plate, and follows later changes", () => {
  let s = staged();
  assert.deepEqual(s.runs.map((r) => [r.name, r.entry, r.number, r.plate]), [
    ["alpha", "e7", "7", "B-2"],
    ["kiri", "e7", "7", "B-2"],
    ["pigeon", "e7", "7", "B-2"],
    ["sunny", "e8", "8", "B-3"],
  ]);
  // The car's number changes: every driver of it follows. A reserve who lost the seat is dropped while queued.
  s = run(s, { type: "syncReg", drivers: [{ name: "alpha", team, entry: { ...car7, number: "70" } }, { name: "kiri", team, entry: { ...car7, number: "70" } }, { name: "sunny", team, entry: car8 }] });
  assert.deepEqual(s.runs.map((r) => [r.name, r.number]), [["alpha", "70"], ["kiri", "70"], ["sunny", "8"]]);
  assert.equal(fails(s, { type: "syncReg", drivers: [{ name: "alpha", team, entry: { ...car7, number: "70" } }, { name: "kiri", team, entry: { ...car7, number: "70" } }, { name: "sunny", team, entry: car8 }] }), "nothing_to_add");
});

test("a car has one driver on stage: the release skips its other drivers", () => {
  let s = staged();
  s = run(s, { type: "go" }, 1000);
  assert.equal(byName(s, "alpha").status, "onstage");
  s = run(s, { type: "go" }, 2000); // kiri and pigeon wait, sunny of the other car goes
  assert.equal(byName(s, "sunny").status, "onstage");
  assert.equal(byName(s, "kiri").status, "queued");
  assert.equal(fails(s, { type: "go" }, 3000), "car_busy");
  assert.equal(releasable(s.runs, "t1")?.name, undefined);
  s = run(s, { type: "finish", runId: byName(s, "alpha").id }, 100_000);
  assert.equal(releasable(s.runs, "t1")?.name, "kiri");
  s = run(s, { type: "teamGo", team: "t1" }, 101_000);
  assert.equal(byName(s, "kiri").status, "onstage");
});

test("the car takes the place of its fastest driver", () => {
  let s = staged();
  for (const [name, ms] of [["alpha", 90_000], ["kiri", 85_000], ["sunny", 87_000]] as const) {
    s = run(s, { type: "setTime", runId: byName(s, name).id, ms });
  }
  const rows = classify(s.runs);
  assert.deepEqual(rows.filter((r) => r.rank).map((r) => [r.name, r.rank]), [["kiri", 1], ["sunny", 2]]);
  assert.equal(rows.find((r) => r.name === "alpha")!.rank, undefined);
});

test("next driver moves to the front of the car's queue and tells the current and the next driver", () => {
  let s = staged();
  s = run(s, { type: "go" }, 1000); // alpha on stage
  const pigeon = byName(s, "pigeon");
  s = run(s, { type: "nextDriver", runId: pigeon.id, team: "t1" }, 5000);
  assert.deepEqual(s.runs.filter((r) => r.entry === "e7" && r.status === "queued").map((r) => r.name), ["pigeon", "kiri"]);
  const lines = s.radio.map((m) => [m.to, m.text]);
  assert.deepEqual(lines, [[[byName(s, "alpha").id], "Box this lap, pigeon takes over."], [[pigeon.id], "You are next in #7, get ready."]]);
  assert.equal(fails(s, { type: "nextDriver", runId: pigeon.id, team: "other" }, 5000), "not_found");
  assert.equal(fails(s, { type: "nextDriver", runId: byName(s, "alpha").id }, 5000), "not_queued");
});

test("swap driver ends the stint with its best lap and starts the next driver at once", () => {
  let s = staged();
  s = run(s, { type: "go" }, 0); // alpha starts at 3000
  s = run(s, { type: "setMode", runId: byName(s, "alpha").id, mode: "long" }, 100);
  assert.equal(fails(s, { type: "swapDriver", runId: byName(s, "kiri").id }, 2000), "not_running"); // still counting down
  s = run(s, { type: "lap", runId: byName(s, "alpha").id }, 93_000); // 90 s
  s = run(s, { type: "swapDriver", runId: byName(s, "kiri").id, team: "t1" }, 150_000); // last 57 s, best stays 57
  const alpha = byName(s, "alpha");
  const kiri = byName(s, "kiri");
  assert.equal(alpha.status, "finished");
  assert.equal(alpha.rawMs, 57_000);
  assert.equal(kiri.status, "onstage");
  assert.equal(kiri.startedAt, 150_000);
  assert.equal(kiri.mode, "long");
  assert.equal(s.runs.filter((r) => r.entry === "e7" && r.status === "onstage").length, 1);
});

test("swap needs a long run: a quali run is stopped at the line instead", () => {
  let s = staged();
  s = run(s, { type: "go" }, 0);
  assert.equal(fails(s, { type: "swapDriver", runId: byName(s, "kiri").id }, 10_000), "swap_long_run");
});

test("editing info on a run changes every run of the car", () => {
  let s = staged();
  s = run(s, { type: "editInfo", runId: byName(s, "kiri").id, plate: "z-9", number: "77" });
  assert.deepEqual(s.runs.filter((r) => r.entry === "e7").map((r) => [r.number, r.plate]), [["77", "Z-9"], ["77", "Z-9"], ["77", "Z-9"]]);
  assert.equal(byName(s, "sunny").number, "8");
});

test("the driver plan and pit windows are per car, and only the team sees them", () => {
  let s = staged();
  const len = 7_200_000;
  s = run(s, { type: "planAdd", team: "t1", teamName: "Red Team", entry: "e7", driver: "alpha", fromMs: 0, lengthMs: len });
  s = run(s, { type: "planAdd", team: "t1", teamName: "Red Team", entry: "e7", driver: "kiri", fromMs: 2_100_000, lengthMs: len });
  s = run(s, { type: "planAdd", team: "t1", teamName: "Red Team", entry: "e7", driver: "pigeon", fromMs: 2_100_000, lengthMs: len }); // replaces kiri at that time
  assert.deepEqual(s.plan.map((p) => [p.driver, p.fromMs]), [["alpha", 0], ["pigeon", 2_100_000]]);
  assert.equal(fails(s, { type: "planAdd", team: "t1", teamName: "Red Team", entry: "e7", driver: "sunny", fromMs: 0, lengthMs: len }), "not_found"); // drives the other car
  assert.equal(fails(s, { type: "planAdd", team: "t1", teamName: "Red Team", entry: "e7", driver: "alpha", fromMs: len, lengthMs: len }), "invalid");
  s = run(s, { type: "pitAdd", team: "t1", teamName: "Red Team", entry: "e7", fromMs: 1_800_000, toMs: 2_400_000, lengthMs: len });
  assert.equal(s.pitWindows[0].entry, "e7");
  assert.equal(fails(s, { type: "pitAdd", team: "t1", teamName: "Red Team", entry: "nope", fromMs: 0, toMs: 60_000, lengthMs: len }), "not_found");
  assert.equal(viewFor(s, { staff: false, user: "x", teams: [] }).plan.length, 0);
  assert.equal(viewFor(s, { staff: false, user: "x", teams: ["t1"] }).plan.length, 2);
  s = run(s, { type: "planDel", team: "t1", id: s.plan[0].id });
  assert.equal(s.plan.length, 1);
  assert.equal(fails(s, { type: "planDel", team: "other", id: s.plan[0].id }), "not_found");
});

test("a session that stops sharing cars unlinks drivers staged on one car; a number then changes only that driver", () => {
  let s = staged();
  s = run(s, { type: "syncReg", drivers: ["alpha", "kiri", "pigeon", "sunny"].map((name) => ({ name, team })) });
  assert.ok(s.runs.every((r) => !r.entry));
  const kiri = byName(s, "kiri");
  s = run(s, { type: "editInfo", runId: kiri.id, plate: "", number: "12", team: "t1" });
  assert.deepEqual(s.runs.map((r) => [r.name, r.number]), [["alpha", "7"], ["kiri", "12"], ["pigeon", "7"], ["sunny", "8"]]);
  assert.equal(fails(s, { type: "editInfo", runId: kiri.id, plate: "", number: "13", team: "other" }), "not_found");
});
