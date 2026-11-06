import assert from "node:assert/strict";
import { test } from "node:test";
import { computeCut, regPhase, type RegSettings } from "../shared/registration.ts";

const s: RegSettings = { opensAt: 100, deadline: 200, drivers: 3, employees: 1, spectators: 1, factoryReserved: 1, independents: true };
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
