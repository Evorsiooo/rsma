import type { AdminEnv } from "./admin";
import { whoIsPresent } from "../shared/attendance";
import { raceDrivers } from "../shared/registration";
import { attendanceOf, driversIn, groupIn, groupRegs, lineupLockIn, loadEventData, settingsIn, type EventData } from "./reg-data";

export async function teamWithCar(db: D1Database, id: string) {
  const t = await db.prepare("SELECT id, name, kind, car, factory_id AS factoryId FROM teams WHERE id = ?").bind(id).first<{ id: string; name: string; kind: string; car: string | null; factoryId: string | null }>();
  if (!t) return null;
  let car = t.car;
  if (t.kind === "customer" && t.factoryId) car = (await db.prepare("SELECT car FROM teams WHERE id = ?").bind(t.factoryId).first<{ car: string | null }>())?.car ?? null;
  return { id: t.id, name: t.name, car: car ?? undefined };
}

/**
 * Keep one session's queue in step with its registration. Everyone who makes the cut as a driver is staged. In an endurance
 * event only the drivers who hold a race seat of a car that is In are: the first `seats` of the lineup by rank, skipping
 * anyone absent (all of the lineup in sessions that start before the lineups lock). Each carries its car, which holds the number and plate. `present` is the set of drivers who confirmed
 * attendance, or null when the session takes no attendance.
 */
async function syncOne(env: AdminEnv, d: EventData, sid: string, present0: Set<string> | null = null): Promise<void> {
  const settings = settingsIn(d, sid);
  if (!settings) return;
  const group = groupIn(d, sid);
  // Registered drivers who are In; with attendance on, only those who confirmed they are here.
  const staged = whoIsPresent(driversIn(d, sid), settings, attendanceOf(d, sid));
  const present = settings.attendance ? new Set(staged.map((r) => r.userId)) : present0;
  const cars = new Map(groupRegs(d, group).cars.map((c) => [c.id, c]));
  // Sessions that start before the lineups lock take the reserves too; from the lock on only the race seats are staged.
  const lock = lineupLockIn(d, sid);
  const startsAt = d.race?.sessions.find((x) => x.id === sid)?.startsAt ?? null;
  const early = lock !== null && startsAt !== null && startsAt < lock;
  const seated = new Set<string>();
  for (const c of cars.values()) for (const u of raceDrivers(c.drivers.map((x) => x.userId), early ? Infinity : c.seats, present)) seated.add(u);
  const team = (id: string) => {
    const t = d.teams.get(id);
    if (!t) return undefined;
    // A customer team races its factory's car.
    const car = t.kind === "customer" && t.factoryId ? (d.teams.get(t.factoryId)?.car ?? null) : t.car;
    return { id: t.id, name: t.name, car: car ?? undefined };
  };
  const drivers = staged
    .filter((r) => !(settings.endurance && r.carId) || seated.has(r.userId))
    .map((r) => {
      const c = r.carId ? cars.get(r.carId) : undefined;
      return { name: r.username, team: r.teamId ? team(r.teamId) : undefined, entry: settings.endurance && c ? { id: c.id, number: c.number ?? undefined, plate: c.plate ?? undefined } : undefined };
    });
  const stub = env.RACE.get(env.RACE.idFromName(sid));
  await stub.fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd: { type: "syncReg", drivers }, actor: "Registration" }) });
}

/** Sync every session the registration of `sid` covers, each with its own spots and eligibility. One database read for all of them. */
export async function syncRegistered(env: AdminEnv, sid: string): Promise<void> {
  const d = await loadEventData(env, null, { sessionId: sid }, true);
  if (!d.settings.has(sid)) return;
  // A session that is already over keeps the queue it ended with: registrations added later must not put queued rows into its results.
  const now = Date.now();
  const over = new Set((d.race?.sessions ?? []).filter((x) => x.endsAt <= now).map((x) => x.id));
  await Promise.all(groupIn(d, sid).members.filter((m) => !over.has(m.id)).map((m) => syncOne(env, d, m.id)));
}

/** Sessions a team (or one of its members) is registered in, taken before the registrations are deleted. */
export async function regSessionsOf(env: AdminEnv, teamId: string, userId?: string): Promise<string[]> {
  const q = userId
    ? env.DB.prepare("SELECT DISTINCT session_id AS id FROM registrations WHERE team_id = ? AND roblox_id = ?").bind(teamId, userId)
    : env.DB.prepare("SELECT DISTINCT session_id AS id FROM registrations WHERE team_id = ?").bind(teamId);
  return (await q.all<{ id: string }>()).results.map((r) => r.id);
}

export async function syncSessions(env: AdminEnv, ids: string[]): Promise<void> {
  for (const id of ids) await syncRegistered(env, id);
}
