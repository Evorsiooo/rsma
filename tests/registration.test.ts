import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCut, eligibleFor, groupSummary, regPhase, type RegSettings } from "../shared/registration.ts";

const s: RegSettings = { opensAt: 100, deadline: 200, drivers: 3, employees: 1, spectators: 1, factoryReserved: 1, independents: true, teamCap: null, follows: null };
const d = (userId: string, at: number, teamId: string | null, denied = false) => ({ userId, kind: "driver" as const, teamId, denied, at });

test("phase follows the window", () => {
  assert.equal(regPhase(s, 50), "upcoming");
  assert.equal(regPhase(s, 150), "open");
  assert.equal(regPhase(s, 250), "closed");
});

test("factory teams keep a reserved driver even when registered late", () => {
  const cut = computeCut([d("c1", 1, "cust"), d("c2", 2, "cust"), d("c3", 3, "cust"), d("f1", 9, "fac")], s, new Set(["fac"]));
  assert.equal(cut.get("f1"), "in");
  assert.equal(cut.get("c1"), "in");
  assert.equal(cut.get("c2"), "in");
  assert.equal(cut.get("c3"), "waitlist");
});

test("denying a driver moves the next in line up", () => {
  const cut = computeCut([d("c1", 1, "cust", true), d("c2", 2, null), d("c3", 3, null), d("c4", 4, null)], { ...s, factoryReserved: 0 }, new Set());
  assert.equal(cut.get("c1"), "denied");
  assert.deepEqual(["c2", "c3", "c4"].map((u) => cut.get(u)), ["in", "in", "in"]);
});

test("employees and spectators are capped separately", () => {
  const cut = computeCut(
    [
      { userId: "e1", kind: "employee", teamId: "t", denied: false, at: 1 },
      { userId: "e2", kind: "employee", teamId: "t", denied: false, at: 2 },
      { userId: "s1", kind: "spectator", teamId: "t", denied: false, at: 3 },
    ],
    s,
    new Set(),
  );
  assert.deepEqual(["e1", "e2", "s1"].map((u) => cut.get(u)), ["in", "waitlist", "in"]);
});

test("a teams-only session in a group leaves independent drivers out, spots counted per session", () => {
  const regs = [d("i1", 1, null), d("t1", 2, "cust"), d("t2", 3, "cust"), d("i2", 4, null)];
  const open = computeCut(eligibleFor(regs, { independents: true }, true), s, new Set());
  assert.deepEqual(["i1", "t1", "t2"].map((u) => open.get(u)), ["in", "in", "in"]);
  const teamsOnly = computeCut(eligibleFor(regs, { independents: false }, true), { ...s, drivers: 1 }, new Set());
  assert.equal(teamsOnly.get("i1"), undefined);
  assert.equal(teamsOnly.get("t1"), "in");
  assert.equal(teamsOnly.get("t2"), "waitlist");
});

test("a session on its own keeps independents staff added by hand", () => {
  assert.equal(eligibleFor([d("i1", 1, null)], { independents: false }, false).length, 1);
});

test("team cap limits team drivers in total and leaves independents alone", () => {
  const regs = [d("t1", 1, "a"), d("t2", 2, "b"), d("t3", 3, "a"), d("i1", 4, null), d("i2", 5, null)];
  const cut = computeCut(regs, { ...s, drivers: 4, teamCap: 2 }, new Set());
  assert.deepEqual(["t1", "t2", "t3", "i1", "i2"].map((u) => cut.get(u)), ["in", "in", "waitlist", "in", "in"]);
});

test("team cap counts factory reserved drivers and later teams still wait", () => {
  const regs = [d("c1", 1, "cust"), d("f1", 2, "fac"), d("f2", 3, "fac"), d("c2", 4, "cust")];
  const cut = computeCut(regs, { ...s, drivers: 4, factoryReserved: 1, teamCap: 2 }, new Set(["fac"]));
  assert.deepEqual(["c1", "f1", "f2", "c2"].map((u) => cut.get(u)), ["in", "in", "waitlist", "waitlist"]);

test("group summary says who takes part in what", () => {
  const g = [{ id: "a", name: "Open track", teamsOnly: false }, { id: "b", name: "Timed runs", teamsOnly: true }];
  assert.equal(groupSummary(g.slice(0, 1)), null);
  assert.deepEqual(groupSummary(g), {
    independents: "Independent drivers take part in Open track only and cannot take part in Timed runs.",
    teams: "Team drivers are registered for Open track and Timed runs with one registration.",
  });
  assert.equal(groupSummary(g.map((m) => ({ ...m, teamsOnly: false })))?.independents, "Independent drivers take part in Open track and Timed runs.");
});
