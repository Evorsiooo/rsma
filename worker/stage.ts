import type { AdminEnv } from "./admin";
import { loadRegs, loadSettings } from "./registration";

export async function teamWithCar(db: D1Database, id: string) {
  const t = await db.prepare("SELECT id, name, kind, car, factory_id AS factoryId FROM teams WHERE id = ?").bind(id).first<{ id: string; name: string; kind: string; car: string | null; factoryId: string | null }>();
  if (!t) return null;
  let car = t.car;
  if (t.kind === "customer" && t.factoryId) car = (await db.prepare("SELECT car FROM teams WHERE id = ?").bind(t.factoryId).first<{ car: string | null }>())?.car ?? null;
  return { id: t.id, name: t.name, car: car ?? undefined };
}

/** Keep a session's queue in step with its registration: everyone who makes the cut as a driver is staged. */
export async function syncRegistered(env: AdminEnv, sid: string): Promise<void> {
  const settings = await loadSettings(env, sid);
  if (!settings) return;
  const drivers = [];
  for (const r of await loadRegs(env, sid, settings)) {
    if (r.kind !== "driver" || r.cut !== "in") continue;
    drivers.push({ name: r.username, team: r.teamId ? ((await teamWithCar(env.DB, r.teamId)) ?? undefined) : undefined });
  }
  const stub = env.RACE.get(env.RACE.idFromName(sid));
  await stub.fetch("http://do/cmd", { method: "POST", body: JSON.stringify({ cmd: { type: "syncReg", drivers }, actor: "Registration" }) });
}
