import type { Hono, MiddlewareHandler } from "hono";
import type { Me } from "../shared/types";
import type { AdminEnv } from "./admin";
import { cleanUsername, driversOf, eventPoints, eventProblem, MAX_ROWS, type ChampEvent, type PointsConfig, type ResultRow } from "../shared/standings";

interface Row {
  sessionId: string;
  position: number;
  car: string | null;
  username: string;
  teamId: string | null;
  teamName: string | null;
  timeMs: number | null;
  gapMs: number | null;
}

/** The statements that read every typed-in result and its stint logs, for the sessions given (all when none). */
export const resultQueries = (db: D1Database) => [
  db.prepare(
    `SELECT r.session_id AS sessionId, r.position, r.car, r.username, r.team_id AS teamId, COALESCE(t.name, r.team_name) AS teamName, r.time_ms AS timeMs, r.gap_ms AS gapMs
     FROM session_results r LEFT JOIN teams t ON t.id = r.team_id ORDER BY r.session_id, r.position`,
  ),
  db.prepare("SELECT session_id AS sessionId, position, username FROM session_result_drivers ORDER BY session_id, position, seq"),
];

/** Typed-in results grouped per session, as result rows with their stint logs. */
export function groupResults(rows: Row[], stints: { sessionId: string; position: number; username: string }[]): Map<string, ResultRow[]> {
  const bySession = new Map<string, ResultRow[]>();
  for (const { sessionId, ...r } of rows) {
    const list = bySession.get(sessionId) ?? [];
    const drivers = stints.filter((s) => s.sessionId === sessionId && s.position === r.position).map((s) => ({ username: s.username }));
    list.push({ ...r, drivers: drivers.length > 0 ? drivers : undefined });
    bySession.set(sessionId, list);
  }
  return bySession;
}

export async function resultsOf(db: D1Database, sessionId: string): Promise<ResultRow[]> {
  const [rows, stints] = await db.batch(resultQueries(db));
  return groupResults(
    (rows.results as unknown as Row[]).filter((r) => r.sessionId === sessionId),
    stints.results as unknown as { sessionId: string; position: number; username: string }[],
  ).get(sessionId) ?? [];
}

type Body = { results?: unknown };

interface SessionInfo {
  name: string;
  startsAt: number;
  scoring: "position" | "window";
  windowMs: number | null;
  halfPoints: number;
  championship: number;
}

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : NaN);

/** The rows of a request body, with each team name matched to a team we hold; or "invalid". */
async function parseRows(db: D1Database, b: Body): Promise<ResultRow[] | "invalid"> {
  if (!Array.isArray(b.results) || b.results.length === 0 || b.results.length > MAX_ROWS) return "invalid";
  const teams = (await db.prepare("SELECT id, name FROM teams").all<{ id: string; name: string }>()).results;
  const out: ResultRow[] = [];
  for (const [i, raw] of (b.results as Record<string, unknown>[]).entries()) {
    const timeMs = num(raw.timeMs);
    const gapMs = num(raw.gapMs);
    if (Number.isNaN(timeMs) || Number.isNaN(gapMs) || !Array.isArray(raw.drivers) || raw.drivers.length > 20) return "invalid";
    const names = (raw.drivers as unknown[]).map(cleanUsername);
    if (names.length === 0 || names.some((n) => !n)) return "invalid";
    const typed = typeof raw.teamName === "string" ? raw.teamName.trim().slice(0, 60) : "";
    const team = teams.find((t) => t.name.toLowerCase() === typed.toLowerCase());
    const car = typeof raw.car === "string" && raw.car.trim() ? raw.car.trim().slice(0, 60) : null;
    out.push({ position: i + 1, username: names[0], car, drivers: names.length > 1 || car ? names.map((username) => ({ username })) : undefined, teamId: team?.id ?? null, teamName: team?.name ?? (typed || null), timeMs, gapMs });
  }
  return out;
}

/** Admin routes under /api/admin/sessions/:id/results, behind the races role. */
export function mountSessionResults(app: Hono<{ Bindings: AdminEnv; Variables: { me: Me } }>, g: MiddlewareHandler) {
  app.get("/sessions/:id/results", g, async (c) => {
    const id = c.req.param("id") ?? "";
    if (!(await info(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
    return c.json({ results: await resultsOf(c.env.DB, id) });
  });

  app.put("/sessions/:id/results", g, async (c) => {
    const id = c.req.param("id") ?? "";
    const s = await info(c.env.DB, id);
    if (!s) return c.json({ error: "not_found" }, 404);
    const results = await parseRows(c.env.DB, (await c.req.json().catch(() => ({}))) as Body);
    if (results === "invalid") return c.json({ error: "invalid" }, 400);
    const ev: Pick<ChampEvent, "name" | "heldAt" | "mode" | "windowMs" | "results"> = { name: s.name, heldAt: s.startsAt, mode: s.scoring, windowMs: s.windowMs, results };
    if (eventProblem(ev)) return c.json({ error: "invalid" }, 400);
    const db = c.env.DB;
    await db.batch([
      db.prepare("DELETE FROM session_results WHERE session_id = ?").bind(id),
      db.prepare("DELETE FROM session_result_drivers WHERE session_id = ?").bind(id),
      ...results.map((r) => db.prepare("INSERT INTO session_results (session_id, position, car, username, team_id, team_name, time_ms, gap_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, r.position, r.car ?? null, r.username, r.teamId, r.teamName, r.timeMs, r.gapMs)),
      ...results.flatMap((r) => (r.drivers ?? []).map((d, seq) => db.prepare("INSERT INTO session_result_drivers (session_id, position, seq, username) VALUES (?, ?, ?, ?)").bind(id, r.position, seq, d.username))),
    ]);
    return c.json({ ok: true });
  });

  app.delete("/sessions/:id/results", g, async (c) => {
    const id = c.req.param("id") ?? "";
    await c.env.DB.batch(clearStatements(c.env.DB, id));
    return c.json({ ok: true });
  });
}

/** Removes a session's typed-in results; appended to whatever deletes the session. */
export const clearStatements = (db: D1Database, sessionId: string) => [
  db.prepare("DELETE FROM session_results WHERE session_id = ?").bind(sessionId),
  db.prepare("DELETE FROM session_result_drivers WHERE session_id = ?").bind(sessionId),
];

/** What the public sees for one session: its typed-in results, and the points when it counts for the championship. */
export async function publicResults(db: D1Database, sessionId: string, config: PointsConfig) {
  const results = await resultsOf(db, sessionId);
  if (results.length === 0) return { results, points: null as number[] | null };
  const s = await info(db, sessionId);
  const points = s?.championship ? eventPoints({ half: !!s.halfPoints, mode: s.scoring, windowMs: s.windowMs, results }, config) : null;
  return { results, points };
}
const info = (db: D1Database, id: string) =>
  db.prepare("SELECT name, starts_at AS startsAt, scoring, window_ms AS windowMs, half_points AS halfPoints, championship FROM sessions WHERE id = ?").bind(id).first<SessionInfo>();
