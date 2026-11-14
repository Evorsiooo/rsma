import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTeamLimit, computeCut, eligibleFor, fullNotice, groupSummary, heldSpots, orderRule, regPhase, spotsLine, statusText, waitPositions, type RegSettings } from "../shared/registration.ts";

const s: RegSettings = { opensAt: 100, deadline: 200, drivers: 3, employees: 1, spectators: 1, factoryReserved: 1, independents: true, teamCap: null, teamLimit: null, pickCutoff: null, follows: null };
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

test("a linked group has one cut: a person is never In for one session and Waiting for another", () => {
  // Spots are shared by the group, so independents use up spots even though a teams-only session leaves them out.
  const regs = [d("i1", 1, null), d("t1", 2, "cust"), d("t2", 3, "cust"), d("t3", 4, "cust")];
  const cut = computeCut(regs, { ...s, drivers: 3 }, new Set());
  assert.deepEqual(["i1", "t1", "t2", "t3"].map((u) => cut.get(u)), ["in", "in", "in", "waitlist"]);
  const teamsOnly = eligibleFor(regs, { independents: false }, true).map((r) => r.userId);
  assert.deepEqual(teamsOnly, ["t1", "t2", "t3"]);
});

test("reserved factory spots are held until a factory driver takes them", () => {
  const regs = [d("c1", 1, "cust"), d("c2", 2, "cust"), d("c3", 3, "cust")];
  const fac = new Set(["fac"]);
  const held = computeCut(regs, s, fac);
  assert.deepEqual(["c1", "c2", "c3"].map((u) => held.get(u)), ["in", "in", "waitlist"]);
  assert.equal(heldSpots(regs, s, fac), 1);
  // Without holding, the last one is In until a factory driver registers and pushes them out.
  assert.equal(computeCut(regs, s, fac, false).get("c3"), "in");
  const late = computeCut([...regs, d("f1", 9, "fac")], s, fac);
  assert.deepEqual(["c1", "c2", "c3", "f1"].map((u) => late.get(u)), ["in", "in", "waitlist", "in"]);
  assert.equal(heldSpots([...regs, d("f1", 9, "fac")], s, fac), 0);
});

test("waiting list is in registration order and moves up when someone ahead leaves", () => {
  const base = [d("a", 1, null), d("b", 2, null), d("c", 3, null), d("e", 4, null)];
  const small = { ...s, drivers: 1, factoryReserved: 0 };
  const pos = (regs: typeof base) => {
    const cut = computeCut(regs, small, new Set());
    return waitPositions(regs.map((r) => ({ ...r, cut: cut.get(r.userId)! })));
  };
  assert.deepEqual([...pos(base)], [["b", 1], ["c", 2], ["e", 3]]);
  assert.deepEqual([...pos(base.filter((r) => r.userId !== "a"))], [["c", 1], ["e", 2]]);
  assert.deepEqual([...pos(base.map((r) => (r.userId === "b" ? { ...r, denied: true } : r)))], [["c", 1], ["e", 2]]);
});

test("wording", () => {
  assert.equal(statusText({ cut: "waitlist", waitPos: 2 }), "Waiting, position 2");
  assert.equal(statusText({ cut: "in", waitPos: null }), "In");
  assert.equal(spotsLine({ spots: 10, taken: 8, waiting: 0, held: 1 }), "8 of 10 taken, 1 held for factory teams, 1 free");
  assert.equal(spotsLine({ spots: 4, taken: 4, waiting: 2, held: 0 }), "4 of 4 taken, 2 waiting");
  assert.match(fullNotice({ spots: 4, taken: 4, waiting: 2, held: 0 }, "driver")!, /position 3/);
  assert.match(fullNotice({ spots: 4, taken: 4, waiting: 2, held: 0 }, "driver", { team: true })!, /A driver you register now will be Waiting, from position 3/);
  assert.equal(fullNotice({ spots: 4, taken: 3, waiting: 0, held: 0 }, "driver"), null);
  assert.match(orderRule({ factoryReserved: 1 }), /order people registered.*only exception.*factory team has 1 reserved spot/);
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
});

test("group summary says who takes part in what", () => {
  const g = [{ id: "a", name: "Open track", teamsOnly: false }, { id: "b", name: "Timed runs", teamsOnly: true }];
  assert.equal(groupSummary(g.slice(0, 1)), null);
  assert.deepEqual(groupSummary(g), {
    independents: "Independent drivers take part in Open track only and cannot take part in Timed runs.",
    teams: "Team drivers are registered for Open track and Timed runs with one registration.",
  });
  assert.equal(groupSummary(g.map((m) => ({ ...m, teamsOnly: false })))?.independents, "Independent drivers take part in Open track and Timed runs.");
});

test("team limit fields a team's own choice, or its first drivers, and leaves other teams alone", () => {
  const cut = (userId: string, at: number, teamId: string | null) => ({ ...d(userId, at, teamId), cut: "in" as const });
  const regs = [cut("a1", 1, "a"), cut("a2", 2, "a"), cut("a3", 3, "a"), cut("b1", 4, "b"), cut("i1", 5, null)];
  const out = (picks: string[]) => applyTeamLimit(regs, 2, new Set(picks)).map((r) => r.cut).join(",");
  assert.equal(out([]), "in,in,out,in,in");
  assert.equal(out(["a3", "a1"]), "in,out,in,in,in");
  assert.equal(out(["a3"]), "out,out,in,in,in");
  assert.equal(applyTeamLimit(regs, null, new Set()), regs);
});
