import type { AdminEnv } from "./admin";
import { groupIn, loadEventData, regsIn, settingsIn, type EventData } from "./reg-data";

export async function teamWithCar(db: D1Database, id: string) {
  const t = await db.prepare("SELECT id, name, kind, car, factory_id AS factoryId FROM teams WHERE id = ?").bind(id).first<{ id: string; name: string; kind: string; car: string | null; factoryId: string | null }>();
  if (!t) return null;
  let car = t.car;
  if (t.kind === "customer" && t.factoryId) car = (await db.prepare("SELECT car FROM teams WHERE id = ?").bind(t.factoryId).first<{ car: string | null }>())?.car ?? null;
  return { id: t.id, name: t.name, car: car ?? undefined };
}

/** Keep one session's queue in step with its registration: everyone who makes the cut as a driver is staged. */
async function syncOne(env: AdminEnv, d: EventData, sid: string): Promise<void> {
  const settings = settingsIn(d, sid);
  if (!settings) return;
  const staged = regsIn(d, sid, settings, groupIn(d, sid)).filter((r) => r.kind === "driver" && r.cut === "in");
  const team = (id: string) => {
    const t = d.teams.get(id);
    if (!t) return undefined;
    // A customer team races its factory's car.
    const car = t.kind === "customer" && t.factoryId ? (d.teams.get(t.factoryId)?.car ?? null) : t.car;
    return { id: t.id, name: t.name, car: car ?? undefined };
  };
  const drivers = staged.map((r) => ({ name: r.username, team: r.teamId ? team(r.teamId) : undefined }));
  const stub = env.RACE.get(env.RACE.idFromName(sid));
  await stub.fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd: { type: "syncReg", drivers }, actor: "Registration" }) });
}

/** Sync every session the registration of `sid` covers, each with its own spots and eligibility. One database read for all of them. */
export async function syncRegistered(env: AdminEnv, sid: string): Promise<void> {
  const d = await loadEventData(env, null, { sessionId: sid }, true);
  if (!d.settings.has(sid)) return;
  await Promise.all(groupIn(d, sid).members.map((m) => syncOne(env, d, m.id)));
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
