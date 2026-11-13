import type { AdminEnv } from "./admin";
import { loadGroup, loadRegs, loadSettings } from "./registration";

export async function teamWithCar(db: D1Database, id: string) {
  const t = await db.prepare("SELECT id, name, kind, car, factory_id AS factoryId FROM teams WHERE id = ?").bind(id).first<{ id: string; name: string; kind: string; car: string | null; factoryId: string | null }>();
  if (!t) return null;
  let car = t.car;
  if (t.kind === "customer" && t.factoryId) car = (await db.prepare("SELECT car FROM teams WHERE id = ?").bind(t.factoryId).first<{ car: string | null }>())?.car ?? null;
  return { id: t.id, name: t.name, car: car ?? undefined };
}

/** Keep one session's queue in step with its registration: everyone who makes the cut as a driver is staged. */
async function syncOne(env: AdminEnv, sid: string): Promise<void> {
  const settings = await loadSettings(env, sid);
  if (!settings) return;
  const staged = (await loadRegs(env, sid, settings)).filter((r) => r.kind === "driver" && r.cut === "in");
  // One lookup per team, all at once, instead of one per driver in turn.
  const teams = new Map(await Promise.all([...new Set(staged.flatMap((r) => (r.teamId ? [r.teamId] : [])))].map(async (id) => [id, (await teamWithCar(env.DB, id)) ?? undefined] as const)));
  const drivers = staged.map((r) => ({ name: r.username, team: r.teamId ? teams.get(r.teamId) : undefined }));
  const stub = env.RACE.get(env.RACE.idFromName(sid));
  await stub.fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd: { type: "syncReg", drivers }, actor: "Registration" }) });
}

/** Sync every session the registration of `sid` covers, each with its own spots and eligibility. */
export async function syncRegistered(env: AdminEnv, sid: string): Promise<void> {
  await Promise.all((await loadGroup(env, sid)).members.map((m) => syncOne(env, m.id)));
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
