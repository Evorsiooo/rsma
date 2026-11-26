import assert from "node:assert/strict";
import { test } from "node:test";
import { carName, computeEnduranceCut, lineupLine, lineupOf, raceDrivers, spotsLine, type RegSettings } from "../shared/registration.ts";

const s: RegSettings = { opensAt: 100, deadline: 200, drivers: 2, employees: 1, spectators: 1, factoryReserved: 0, independents: true, teamCap: null, teamLimit: null, pickCutoff: null, follows: null, endurance: true, carsPerTeam: 3, seatsPerCar: 2 };
const d = (userId: string, at: number, teamId: string | null, denied = false) => ({ userId, kind: "driver" as const, teamId, denied, at });
const car = (id: string, teamId: string, at: number, drivers: string[]) => ({ id, teamId, at, drivers });

test("spots count cars, not drivers", () => {
  // One team, one car with three drivers takes one of the two spots.
  const regs = [d("a", 1, "T"), d("b", 2, "T"), d("c", 3, "T"), d("i", 4, null)];
  const r = computeEnduranceCut(regs, [car("c1", "T", 10, ["a", "b", "c"])], s, new Set());
  assert.deepEqual(["a", "b", "c", "i"].map((u) => r.cut.get(u)), ["in", "in", "in", "in"]);
  assert.equal(r.carCut.get("c1"), "in");
});

test("cars are cut in the order they were created and wait as a whole", () => {
  const regs = [d("a", 1, "T"), d("b", 2, "U"), d("c", 3, "V"), d("e", 4, "V")];
  const cars = [car("late", "V", 30, ["c", "e"]), car("t", "T", 10, ["a"]), car("u", "U", 20, ["b"])];
  const r = computeEnduranceCut(regs, cars, s, new Set());
  assert.deepEqual([...r.carCut], [["late", "waitlist"], ["t", "in"], ["u", "in"]]);
  assert.deepEqual(["c", "e"].map((u) => r.cut.get(u)), ["waitlist", "waitlist"]);
  // Both drivers of the waiting car share its place.
  assert.deepEqual(["c", "e"].map((u) => r.driverWait.get(u)), [1, 1]);
});

test("a car with no registered driver takes no spot", () => {
  const regs = [d("a", 1, "T"), d("b", 2, "U")];
  const r = computeEnduranceCut(regs, [car("empty", "T", 1, []), car("u", "U", 2, ["b"])], s, new Set());
  assert.equal(r.carCut.get("empty"), "waitlist");
  assert.equal(r.cut.get("b"), "in");
  // "a" is registered but in no car.
  assert.equal(r.cut.get("a"), "out");
});

test("a denied driver leaves the lineup and the ranks close up", () => {
  const regs = [d("a", 1, "T", true), d("b", 2, "T"), d("c", 3, "T")];
  const lineup = lineupOf([car("c1", "T", 1, ["a", "b", "c"])], regs).get("c1")!;
  assert.deepEqual(lineup, ["b", "c"]);
  assert.equal(computeEnduranceCut(regs, [car("c1", "T", 1, ["a", "b", "c"])], s, new Set()).cut.get("a"), "denied");
  // Denying the only driver leaves a car without drivers: it no longer takes a spot.
  const only = computeEnduranceCut([d("a", 1, "T", true), d("i", 2, null), d("j", 3, null)], [car("c1", "T", 1, ["a"])], s, new Set());
  assert.deepEqual(["i", "j"].map((u) => only.cut.get(u)), ["in", "in"]);
});

test("a driver sits in one car and must belong to the car's team", () => {
  const regs = [d("a", 1, "T"), d("b", 2, "U")];
  const lineups = lineupOf([car("x", "T", 1, ["a", "b"]), car("y", "T", 2, ["a"])], regs);
  assert.deepEqual(lineups.get("x"), ["a"]);
  assert.deepEqual(lineups.get("y"), []);
});

test("factory reserved spots are reserved cars and the team cap counts cars", () => {
  const regs = [d("c1", 1, "cust"), d("c2", 2, "cust2"), d("f", 9, "fac")];
  const cars = [car("a", "cust", 1, ["c1"]), car("b", "cust2", 2, ["c2"]), car("f1", "fac", 9, ["f"])];
  const r = computeEnduranceCut(regs, cars, { ...s, factoryReserved: 1 }, new Set(["fac"]));
  assert.equal(r.carCut.get("f1"), "in");
  assert.equal(r.carCut.get("a"), "in");
  assert.equal(r.carCut.get("b"), "waitlist");
  // A factory that has not entered its car yet holds its spot.
  const held = computeEnduranceCut([d("c1", 1, "cust"), d("c2", 2, "cust2")], [car("a", "cust", 1, ["c1"]), car("b", "cust2", 2, ["c2"])], { ...s, factoryReserved: 1 }, new Set(["fac"]));
  assert.equal(held.held, 1);
  assert.equal(held.carCut.get("b"), "waitlist");
  // The team cap is over all teams together, counted in cars: one team car takes it, the others wait.
  const capped = computeEnduranceCut(regs, cars, { ...s, drivers: 3, teamCap: 1 }, new Set());
  assert.deepEqual([...capped.carCut], [["a", "in"], ["b", "waitlist"], ["f1", "waitlist"]]);
});

test("independents are one-driver cars and employees are unchanged", () => {
  const regs = [d("i", 1, null), d("j", 2, null), d("k", 3, null), { userId: "e", kind: "employee" as const, teamId: "T", denied: false, at: 4 }];
  const r = computeEnduranceCut(regs, [], s, new Set());
  assert.deepEqual(["i", "j", "k", "e"].map((u) => r.cut.get(u)), ["in", "in", "waitlist", "in"]);
  assert.equal(r.driverWait.get("k"), 1);
});

test("seat rule: the first seats drivers by rank race, absent drivers are skipped", () => {
  const lineup = ["a", "b", "c", "d"];
  assert.deepEqual(raceDrivers(lineup, 2), ["a", "b"]);
  assert.deepEqual(raceDrivers(lineup, 2, new Set(["a", "c", "d"])), ["a", "c"]);
  assert.deepEqual(raceDrivers(lineup, 2, new Set(["d"])), ["d"]);
  assert.deepEqual(raceDrivers(lineup, 2, new Set()), []);
  assert.deepEqual(raceDrivers([], 3), []);
});

test("wording", () => {
  assert.equal(spotsLine({ spots: 12, taken: 3, waiting: 0, held: 0 }, "cars"), "3 of 12 cars taken, 9 free");
  assert.equal(spotsLine({ spots: 10, taken: 8, waiting: 0, held: 0 }), "8 of 10 taken, 2 free");
  assert.equal(lineupLine(5, 3), "Race: 3 · Reserve: 2");
  assert.equal(lineupLine(2, 3), "Race: 2 · Reserve: 0");
  assert.equal(carName({ label: "Team car", number: "12" }), "#12 Team car");
  assert.equal(carName({ label: "Team car", number: null }), "Team car");
});
