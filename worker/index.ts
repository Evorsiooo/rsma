import { Hono } from "hono";
import type { RaceSummary } from "../shared/types";
import type { Me } from "../shared/types";
import { auth, getMe, hasRole, type AuthEnv } from "./auth";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "./auth/session";
import { admin } from "./admin";

export { RaceDO } from "./race-do";

interface Env extends AuthEnv {
  RACE: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.route("/api/auth", auth);
app.route("/api/admin", admin);

app.get("/api/me", async (c) => c.json(await getMe(c.env, getCookie(c, SESSION_COOKIE))));

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});

const RACE_COLS = "id, name, expires_at AS expiresAt, (status = 'archived' OR expires_at <= ?1) AS ended";
const asRace = (r: Omit<RaceSummary, "ended"> & { ended: number }): RaceSummary => ({ ...r, ended: !!r.ended });

// Public: races that are active and not expired.
app.get("/api/races", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${RACE_COLS} FROM races WHERE status = 'active' AND expires_at > ?1 ORDER BY expires_at ASC`,
  )
    .bind(Date.now())
    .all<Omit<RaceSummary, "ended"> & { ended: number }>();
  return c.json(results.map(asRace));
});

// Public: archived or expired races, newest first. Their results stay readable.
app.get("/api/races/past", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${RACE_COLS} FROM races WHERE status = 'archived' OR expires_at <= ?1 ORDER BY expires_at DESC LIMIT 50`,
  )
    .bind(Date.now())
    .all<Omit<RaceSummary, "ended"> & { ended: number }>();
  return c.json(results.map(asRace));
});

async function raceExists(db: D1Database, id: string) {
  return db.prepare("SELECT 1 FROM races WHERE id = ?").bind(id).first();
}

async function raceEnded(db: D1Database, id: string) {
  const row = await db
    .prepare("SELECT (status = 'archived' OR expires_at <= ?) AS ended FROM races WHERE id = ?")
    .bind(Date.now(), id)
    .first<{ ended: number }>();
  return row ? !!row.ended : null;
}

app.get("/api/races/:id", async (c) => {
  const row = await c.env.DB.prepare(`SELECT ${RACE_COLS} FROM races WHERE id = ?2`)
    .bind(Date.now(), c.req.param("id"))
    .first<Omit<RaceSummary, "ended"> & { ended: number }>();
  return row ? c.json(asRace(row)) : c.json({ error: "not_found" }, 404);
});

app.get("/api/races/:id/state", async (c) => {
  const id = c.req.param("id");
  if (!(await raceExists(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  return c.env.RACE.get(c.env.RACE.idFromName(id)).fetch("http://do/state");
});

async function isRaceSteward(env: Env, me: Me | null, raceId: string) {
  if (!me) return false;
  if (hasRole(me, "steward")) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM race_stewards WHERE race_id = ? AND roblox_id = ?").bind(raceId, me.id).first());
}

// Public live feed, or the staff feed (full state with audit log) for stewards.
app.get("/api/races/:id/ws", async (c) => {
  const id = c.req.param("id");
  if (!(await raceExists(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  const headers = new Headers(c.req.raw.headers);
  for (const h of ["x-staff", "x-user", "x-teams"]) headers.delete(h);
  if (c.req.query("staff") === "1" || c.req.query("auth") === "1") {
    const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
    if (!me) return c.json({ error: "unauthorized" }, 401);
    if (c.req.query("staff") === "1") {
      if (!(await isRaceSteward(c.env, me, id))) return c.json({ error: "forbidden" }, 403);
      headers.set("x-staff", "1");
    } else {
      // Signed-in feed: own radio, plus the channels of the teams this user may open.
      headers.set("x-user", me.username);
      headers.set("x-teams", me.teams.map((t) => t.id).join(","));
    }
  }
  return c.env.RACE.get(c.env.RACE.idFromName(id)).fetch("http://do/ws", new Request(c.req.raw, { headers }));
});

// Steward commands. The role check happens here; the Durable Object validates and applies.
app.post("/api/races/:id/cmd", async (c) => {
  const id = c.req.param("id");
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  if (!(await raceExists(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  if (!(await isRaceSteward(c.env, me, id))) return c.json({ error: "forbidden" }, 403);
  if (await raceEnded(c.env.DB, id)) return c.json({ error: "race_ended" }, 409);
  const cmd = await c.req.json().catch(() => null);
  if (!cmd || typeof cmd.type !== "string") return c.json({ error: "invalid" }, 400);
  if (cmd.type === "add" && cmd.team != null) {
    // Take the team name from the database, never from the client.
    const team = typeof cmd.team.id === "string" ? await c.env.DB.prepare("SELECT id, name FROM teams WHERE id = ?").bind(cmd.team.id).first<{ id: string; name: string }>() : null;
    if (!team) return c.json({ error: "invalid" }, 400);
    cmd.team = team;
  }
  return c.env.RACE.get(c.env.RACE.idFromName(id)).fetch("http://do/cmd", {
    method: "POST",
    body: JSON.stringify({ cmd, actor: me.username }),
  });
});

// Team names for the staging dropdown.
app.get("/api/teams", async (c) => {
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  const { results } = await c.env.DB.prepare("SELECT id, name FROM teams ORDER BY lower(name)").all<{ id: string; name: string }>();
  return c.json(results);
});

// Team radio: members of the team send to their own channel. Stewards see it in the staff feed.
app.post("/api/races/:id/team/:teamId/radio", async (c) => {
  const id = c.req.param("id");
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  const team = me.teams.find((t) => t.id === c.req.param("teamId"));
  if (!team) return c.json({ error: "forbidden" }, 403);
  if (!(await raceExists(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  if (await raceEnded(c.env.DB, id)) return c.json({ error: "race_ended" }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
  if (typeof body.text !== "string") return c.json({ error: "invalid" }, 400);
  return c.env.RACE.get(c.env.RACE.idFromName(id)).fetch("http://do/cmd", {
    method: "POST",
    body: JSON.stringify({ cmd: { type: "teamRadio", team: team.id, teamName: team.name, text: body.text }, actor: me.username }),
  });
});

// Whether the signed-in user may steward this race (drives the UI gate; the API checks again).
app.get("/api/races/:id/access", async (c) => {
  const id = c.req.param("id");
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  return c.json({ steward: await isRaceSteward(c.env, me, id) });
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
