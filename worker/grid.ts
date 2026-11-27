import type { AdminEnv } from "./admin";
import { attendancePhase, whoIsPresent } from "../shared/attendance";
import { computeGrid, qualifyingOf, type GridRow } from "../shared/grid";
import { classify, type RaceState } from "../shared/race";
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
    loadEventData(env, null, { sessionId: sid }),
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
    return c ? { ...r, entry: c.id, number: c.number ?? undefined, plate: c.plate ?? "" } : r;
  });
  return { from: { id: q.id, name: q.name }, attendance: !!settings?.attendance, rows: computeGrid(rows, present) };
}
