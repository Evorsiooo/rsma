import type { Hono, MiddlewareHandler } from "hono";
import type { Me } from "../shared/types";
import type { AdminEnv } from "./admin";
import { groupResults, resultQueries } from "./session-results";
import { classify, type RaceState } from "../shared/race";
import { cleanUsername, configProblem, DEFAULT_CONFIG, eventProblem, MAX_ROWS, type ChampEvent, type PointsConfig, type ResultRow, type StandingsData } from "../shared/standings";

const KEY = "standings";

interface EventRow {
  id: string;
  name: string;
  heldAt: number;
  half: number;
  mode: "position" | "window";
  windowMs: number | null;
}
interface ResRow extends ResultRow {
  eventId: string;
}

interface SessionEv {
  id: string;
  name: string;
  raceName: string;
  startsAt: number;
  halfPoints: number;
  scoring: "position" | "window";
  windowMs: number | null;
}

/** The points settings, or the defaults. */
export async function loadConfig(db: D1Database): Promise<PointsConfig> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  try {
    const saved = JSON.parse(row?.value ?? "null") as PointsConfig | null;
    if (saved && !configProblem(saved)) return saved;
  } catch {
    // an unreadable setting falls back to the defaults
  }
  return DEFAULT_CONFIG;
}

/** Settings, hand-entered events, and the sessions marked for the championship, scored from their finished runs. */
export async function loadStandings(env: { DB: D1Database; RACE: DurableObjectNamespace }): Promise<StandingsData> {
  const db = env.DB;
  const [cfg, events, results, sessions, enteredRows, enteredStints] = await db.batch([
    db.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY),
    db.prepare("SELECT id, name, held_at AS heldAt, half, mode, window_ms AS windowMs FROM championship_events ORDER BY held_at, name"),
    db.prepare(
      `SELECT r.event_id AS eventId, r.position, r.username, r.team_id AS teamId, COALESCE(t.name, r.team_name) AS teamName, r.time_ms AS timeMs, r.gap_ms AS gapMs
       FROM championship_results r LEFT JOIN teams t ON t.id = r.team_id ORDER BY r.event_id, r.position`,
    ),
    db.prepare(
      `SELECT s.id, s.name, r.name AS raceName, s.starts_at AS startsAt, s.half_points AS halfPoints, s.scoring, s.window_ms AS windowMs
       FROM sessions s JOIN races r ON r.id = s.race_id WHERE s.championship = 1 AND s.starts_at <= ?`,
    ).bind(Date.now()),
    ...resultQueries(db),
  ]);
  let config: PointsConfig = DEFAULT_CONFIG;
  try {
    const saved = JSON.parse(((cfg.results[0] as { value: string } | undefined)?.value) ?? "null") as PointsConfig | null;
    if (saved && !configProblem(saved)) config = saved;
  } catch {
    // an unreadable setting falls back to the defaults
  }
  const byEvent = new Map<string, ResultRow[]>();
  for (const { eventId, ...r } of results.results as unknown as ResRow[]) {
    const list = byEvent.get(eventId) ?? [];
    list.push(r);
    byEvent.set(eventId, list);
  }
  const manual: ChampEvent[] = (events.results as unknown as EventRow[]).map((e) => ({ ...e, half: !!e.half, results: byEvent.get(e.id) ?? [] }));
  const entered = groupResults(enteredRows.results as never, enteredStints.results as never);
  const live = await Promise.all((sessions.results as unknown as SessionEv[]).map((s) => sessionEvent(env, s, entered.get(s.id))));
  return { config, events: [...manual, ...live.filter((e): e is ChampEvent => e != null)] };
}

/** One session as a scored event: the results typed in, or else its best finished run per driver, in order of final time. Null while there are none. */
async function sessionEvent(env: { RACE: DurableObjectNamespace }, s: SessionEv, typed: ResultRow[] | undefined): Promise<ChampEvent | null> {
  // Results typed in against the session win over its timing.
  if (typed && typed.length > 0) return { id: s.id, sessionId: s.id, entered: true, name: `${s.raceName} · ${s.name}`, heldAt: s.startsAt, half: !!s.halfPoints, mode: s.scoring, windowMs: s.windowMs, results: typed };
  try {
    const res = await env.RACE.get(env.RACE.idFromName(s.id)).fetch("http://do/state");
    const { state } = (await res.json()) as { state: RaceState };
    const rows = classify(state.runs ?? []).filter((r) => r.status === "finished" && r.rank != null && r.finalMs != null);
    if (rows.length === 0) return null;
    return {
      id: s.id,
      sessionId: s.id,
      name: `${s.raceName} · ${s.name}`,
      heldAt: s.startsAt,
      half: !!s.halfPoints,
      mode: s.scoring,
      windowMs: s.windowMs,
      results: rows.map((r, i) => ({ position: i + 1, username: r.name, teamId: r.team ?? null, teamName: r.teamName ?? null, timeMs: r.finalMs!, gapMs: null })),
    };
  } catch {
    return null;
  }
}

type Body = { name?: unknown; heldAt?: unknown; half?: unknown; mode?: unknown; windowMs?: unknown; results?: unknown };

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : NaN);

/** The event described by a request body, with each team name matched to a team we hold; or the problem with it. */
async function parseEvent(db: D1Database, id: string, b: Body): Promise<ChampEvent | string> {
  if (!Array.isArray(b.results) || b.results.length > MAX_ROWS) return "invalid";
  const teams = (await db.prepare("SELECT id, name FROM teams").all<{ id: string; name: string }>()).results;
  const results: ResultRow[] = [];
  for (const [i, raw] of (b.results as Record<string, unknown>[]).entries()) {
    const timeMs = num(raw.timeMs);
    const gapMs = num(raw.gapMs);
    if (Number.isNaN(timeMs) || Number.isNaN(gapMs)) return "invalid";
    const typed = typeof raw.teamName === "string" ? raw.teamName.trim().slice(0, 60) : "";
    const team = teams.find((t) => t.name.toLowerCase() === typed.toLowerCase());
    results.push({ position: i + 1, username: typeof raw.username === "string" ? raw.username.trim() : "", teamId: team?.id ?? null, teamName: team?.name ?? (typed || null), timeMs, gapMs });
  }
  const windowMs = num(b.windowMs);
  const ev: ChampEvent = {
    id,
    name: typeof b.name === "string" ? b.name.trim().slice(0, 60) : "",
    heldAt: Number(b.heldAt),
    half: b.half === true,
    mode: b.mode === "window" ? "window" : "position",
    windowMs: Number.isNaN(windowMs) ? 0 : windowMs,
    results,
  };
  return eventProblem(ev) ? "invalid" : ev;
}

const saveEvent = (db: D1Database, ev: ChampEvent, create: boolean) => [
  create
    ? db.prepare("INSERT INTO championship_events (id, name, held_at, half, mode, window_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(ev.id, ev.name, ev.heldAt, ev.half ? 1 : 0, ev.mode, ev.windowMs, Date.now())
    : db.prepare("UPDATE championship_events SET name = ?, held_at = ?, half = ?, mode = ?, window_ms = ? WHERE id = ?").bind(ev.name, ev.heldAt, ev.half ? 1 : 0, ev.mode, ev.windowMs, ev.id),
  ...(create ? [] : [db.prepare("DELETE FROM championship_results WHERE event_id = ?").bind(ev.id)]),
  ...ev.results.map((r) =>
    db.prepare("INSERT INTO championship_results (event_id, position, username, team_id, team_name, time_ms, gap_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(ev.id, r.position, cleanUsername(r.username), r.teamId, r.teamName, r.timeMs, r.gapMs),
  ),
];

/** Admin routes under /api/admin/standings, behind the races role. */
export function mountStandingsAdmin(app: Hono<{ Bindings: AdminEnv; Variables: { me: Me } }>, g: MiddlewareHandler) {
  app.get("/standings", g, async (c) => {
    const [data, teams] = await Promise.all([loadStandings(c.env), c.env.DB.prepare("SELECT name FROM teams ORDER BY lower(name)").all<{ name: string }>()]);
    return c.json({ ...data, teams: teams.results.map((t) => t.name) });
  });

  app.put("/standings/config", g, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Partial<PointsConfig>;
    const cfg: PointsConfig = { points: Array.isArray(b.points) ? b.points.map(Number) : [], windowMs: Number(b.windowMs) };
    if (configProblem(cfg)) return c.json({ error: "invalid" }, 400);
    await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2").bind(KEY, JSON.stringify(cfg)).run();
    return c.json({ ok: true });
  });

  app.post("/standings/events", g, async (c) => {
    const id = `ch_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const ev = await parseEvent(c.env.DB, id, (await c.req.json().catch(() => ({}))) as Body);
    if (typeof ev === "string") return c.json({ error: ev }, 400);
    await c.env.DB.batch(saveEvent(c.env.DB, ev, true));
    return c.json({ id });
  });

  app.put("/standings/events/:id", g, async (c) => {
    const id = c.req.param("id") ?? "";
    if (!(await c.env.DB.prepare("SELECT 1 FROM championship_events WHERE id = ?").bind(id).first())) return c.json({ error: "not_found" }, 404);
    const ev = await parseEvent(c.env.DB, id, (await c.req.json().catch(() => ({}))) as Body);
    if (typeof ev === "string") return c.json({ error: ev }, 400);
    await c.env.DB.batch(saveEvent(c.env.DB, ev, false));
    return c.json({ ok: true });
  });

  /** The half-points switch of one event, without resending its results. */
  app.patch("/standings/events/:id", g, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { half?: unknown };
    if (typeof b.half !== "boolean") return c.json({ error: "invalid" }, 400);
    const r = await c.env.DB.prepare("UPDATE championship_events SET half = ? WHERE id = ?").bind(b.half ? 1 : 0, c.req.param("id")).run();
    return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  app.delete("/standings/events/:id", g, async (c) => {
    await c.env.DB.prepare("DELETE FROM championship_events WHERE id = ?").bind(c.req.param("id")).run();
    return c.json({ ok: true });
  });
}
