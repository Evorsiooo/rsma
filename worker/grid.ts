import type { AdminEnv } from "./admin";
import { attendancePhase, whoIsPresent } from "../shared/attendance";
import { computeGrid, qualifyingOf, type GridRow } from "../shared/grid";
import { carText, classify, type RaceState } from "../shared/race";
import { loadSession } from "./sessions";
import { attendanceOf, driversIn, groupIn, groupRegs, loadEventData, settingsIn } from "./reg-data";

export interface GridView {
  /** The session whose times set the grid; null when this session has none. */
  from: { id: string; name: string } | null;
  /** The race takes attendance: a car's place comes from its fastest driver who is present. */
  attendance: boolean;
  rows: GridRow[];
}

/** The starting grid of a race: the qualifying session's finished times, a car using its fastest driver who is racing. */
export async function gridView(env: AdminEnv, sid: string): Promise<GridView | null> {
  const info = await loadSession(env.DB, sid);
  if (!info) return null;
  const qid = info.session.type === "race" ? qualifyingOf(info.session, info.race.sessions) : null;
  const q = qid ? info.race.sessions.find((s) => s.id === qid) : undefined;
  if (!q) return { from: null, attendance: false, rows: [] };
  const [res, d] = await Promise.all([
    env.RACE.get(env.RACE.idFromName(q.id)).fetch("http://do/state"),
    loadEventData(env, null, { sessionId: sid }, true),
  ]);
  const { state } = (await res.json()) as { state: RaceState };
  const settings = settingsIn(d, sid);
  const names = whoIsPresent(driversIn(d, sid), settings, attendanceOf(d, sid)).map((r) => r.username.toLowerCase());
  // Attendance for the race only opens shortly before it starts: until then nobody has answered, so every car with a time counts.
  const present = settings?.attendance && attendancePhase(settings, info.session.startsAt, Date.now()) !== "upcoming" ? new Set(names) : null;
  // Practice and time trials stage every driver as a car of their own, so the registered car of each driver groups them here.
  const carOf = new Map<string, { id: string; number: string | null; plate: string | null }>();
  for (const c of groupRegs(d, groupIn(d, sid)).cars) for (const x of c.drivers) carOf.set(x.username.toLowerCase(), c);
  const rows = classify(state.runs).map((r) => {
    const c = r.entry ? undefined : carOf.get(r.name.toLowerCase());
    return c ? { ...r, entry: c.id, number: r.number ?? c.number ?? undefined, plate: r.plate || (c.plate ?? "") } : r;
  });
  // Anyone who registered after qualifying ended starts from the pit lane: an independent driver, or the whole car they were put in.
  const g = groupRegs(d, groupIn(d, sid));
  const lateIds = new Set(g.regs.filter((r) => r.kind === "driver" && !r.denied && r.at > q.endsAt).map((r) => r.userId));
  const lateCars = new Map(g.cars.filter((c) => c.drivers.some((x) => lateIds.has(x.userId))).map((c) => [c.id, c]));
  const inCar = new Set(g.cars.flatMap((c) => c.drivers.map((x) => x.userId)));
  const lateSolo = g.regs.filter((r) => r.kind === "driver" && r.cut === "in" && lateIds.has(r.userId) && !inCar.has(r.userId));
  // A pit-lane car reads like the qualified ones: team name and the team's car model (a customer team races its factory's car).
  const carName = (c: { teamId: string; teamName: string | null }) => {
    const t = d.teams.get(c.teamId);
    const model = t ? (t.kind === "customer" && t.factoryId ? d.teams.get(t.factoryId)?.car : t.car) : null;
    return carText({ teamName: c.teamName ?? undefined, car: model ?? undefined });
  };
  const timed = computeGrid(rows, present);
  const keep = timed.filter((r) => !(r.entry ? lateCars.has(r.entry) : lateSolo.some((x) => x.username.toLowerCase() === r.driver.toLowerCase())));
  const pit: GridRow[] = [
    ...[...lateCars.values()].filter((c) => c.cut === "in").map((c) => ({ position: 0, entry: c.id, number: c.number ?? rows.find((r) => r.number && c.drivers.some((x) => x.username.toLowerCase() === r.name.toLowerCase()))?.number ?? undefined, car: carName(c), driver: c.drivers.filter((x) => lateIds.has(x.userId)).map((x) => x.username).join(", "), ms: 0, skipped: [], pit: true })),
    ...lateSolo.map((r) => ({ position: 0, entry: null, number: undefined, car: "", driver: r.username, ms: 0, skipped: [], pit: true })),
  ];
  // A car or independent driver that is in the race but has no usable qualifying time (nobody present set one) is not refused: it starts from the pit lane.
  const placed = new Set(timed.map((r) => (r.entry ? `e:${r.entry}` : `d:${r.driver.toLowerCase()}`)));
  const here = (u: string) => !present || present.has(u.toLowerCase());
  const noTime: GridRow[] = [
    ...g.cars.filter((c) => c.cut === "in" && !lateCars.has(c.id) && !placed.has(`e:${c.id}`) && c.drivers.some((x) => here(x.username))).map((c) => ({ position: 0, entry: c.id, number: c.number ?? rows.find((r) => r.number && c.drivers.some((x) => x.username.toLowerCase() === r.name.toLowerCase()))?.number ?? undefined, car: carName(c), driver: c.drivers.filter((x) => here(x.username)).map((x) => x.username).join(", "), ms: 0, skipped: [], pit: true, noTime: true })),
    ...g.regs.filter((r) => r.kind === "driver" && !r.denied && r.cut === "in" && !r.carId && !inCar.has(r.userId) && !lateIds.has(r.userId) && !placed.has(`d:${r.username.toLowerCase()}`) && here(r.username)).map((r) => ({ position: 0, entry: null, number: undefined, car: "", driver: r.username, ms: 0, skipped: [], pit: true, noTime: true })),
  ];
  pit.push(...noTime);
  return { from: { id: q.id, name: q.name }, attendance: !!settings?.attendance, rows: [...keep.map((r, i) => ({ ...r, position: i + 1 })), ...pit] };
}
