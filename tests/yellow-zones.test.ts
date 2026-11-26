import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCommand, type Command } from "../shared/commands.ts";
import { emptyState, viewFor, type RaceState } from "../shared/race.ts";

let n = 0;
const ctx = { now: 1000, actor: "steward", newId: () => `id${++n}` };
const run = (s: RaceState, c: Command) => {
  const r = applyCommand(s, c, ctx);
  assert.ok("state" in r, JSON.stringify(r));
  return r.state;
};
const report: Command = { type: "zoneReport", team: "t1", teamName: "Red Team", seg: "a1", car: "#7" };

test("a report is seen by staff and its own team only", () => {
  const s = run(emptyState(), report);
  assert.equal(s.zoneReports.length, 1);
  assert.equal(viewFor(s, { staff: true, teams: [] }).zoneReports.length, 1);
  assert.equal(viewFor(s, { staff: false, teams: ["t1"] }).zoneReports.length, 1);
  assert.equal(viewFor(s, { staff: false, teams: ["t2"] }).zoneReports.length, 0);
  assert.equal(viewFor(s, { staff: false, teams: [] }).zoneReports.length, 0);
});

test("a team reports a segment once and can withdraw only its own report", () => {
  let s = run(run(emptyState(), report), report);
  assert.equal(s.zoneReports.length, 1);
  assert.ok("error" in applyCommand(s, { type: "zoneWithdraw", team: "t2", id: s.zoneReports[0].id }, ctx));
  s = run(s, { type: "zoneWithdraw", team: "t1", id: s.zoneReports[0].id });
  assert.equal(s.zoneReports.length, 0);
});

test("confirming makes the segment yellow, answers its reports and goes out on the radio", () => {
  let s = run(emptyState(), report);
  s = run(s, { type: "zoneConfirm", seg: "a1", label: "turns 3 to 4" });
  assert.deepEqual(s.zones.map((z) => z.seg), ["a1"]);
  assert.equal(s.zoneReports.length, 0);
  assert.equal(s.radio.at(-1)?.text, "Yellow flag, turns 3 to 4.");
  assert.equal(s.radio.at(-1)?.to, "all");
  // Confirming again changes nothing and says nothing more.
  const again = run(s, { type: "zoneConfirm", seg: "a1", label: "turns 3 to 4" });
  assert.equal(again.radio.length, s.radio.length);
  assert.ok("error" in applyCommand(s, report, ctx));
});

test("clearing and dismissing", () => {
  let s = run(run(emptyState(), report), { type: "zoneDismiss", seg: "a1" });
  assert.equal(s.zoneReports.length, 0);
  assert.equal(s.zones.length, 0);
  s = run(run(s, { type: "zoneConfirm", seg: "a1", label: "turn 2" }), { type: "zoneConfirm", seg: "b2", label: "the pit lane" });
  s = run(s, { type: "zoneClear", seg: "a1", label: "turn 2" });
  assert.equal(s.radio.at(-1)?.text, "Yellow flag cleared, turn 2.");
  assert.deepEqual(s.zones.map((z) => z.seg), ["b2"]);
  s = run(s, { type: "zoneClearAll" });
  assert.equal(s.zones.length, 0);
  assert.equal(s.radio.at(-1)?.text, "All yellow flags cleared.");
});

test("stage reset clears yellows and reports", () => {
  let s = run(run(emptyState(), report), { type: "zoneConfirm", seg: "b2", label: "turn 2" });
  s = run(s, report);
  s = run(s, { type: "reset" });
  assert.equal(s.zones.length + s.zoneReports.length, 0);
});

test("a team reports a confirmed yellow clear, the stewards confirm, and clearing answers the report", () => {
  let s = run(emptyState(), report);
  assert.ok("error" in applyCommand(s, { ...report, clear: true }, ctx), "nothing to clear while the segment is not yellow");
  s = run(s, { type: "zoneConfirm", seg: "a1", label: "turn 3" });
  assert.ok("error" in applyCommand(s, report, ctx), "a yellow segment takes no yellow report");
  s = run(s, { ...report, clear: true });
  assert.equal(s.zoneReports[0].kind, "clear");
  s = run(s, { type: "zoneClear", seg: "a1", label: "turn 3" });
  assert.deepEqual(s.zones, []);
  assert.deepEqual(s.zoneReports, []);
});
