import { Hono } from "hono";
import type { RaceSummary } from "../shared/types";
import { auth, getMe, type AuthEnv } from "./auth";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "./auth/session";

export { RaceDO } from "./race-do";

interface Env extends AuthEnv {
  RACE: DurableObjectNamespace;
  /** "1" only in local development (.dev.vars). Enables /api/dev routes. */
  DEV?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.route("/api/auth", auth);

app.get("/api/me", async (c) => c.json(await getMe(c.env, getCookie(c, SESSION_COOKIE))));

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});

// Public: races that are active and not expired.
app.get("/api/races", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, expires_at AS expiresAt FROM races WHERE status = 'active' AND expires_at > ? ORDER BY expires_at ASC",
  )
    .bind(Date.now())
    .all<RaceSummary>();
  return c.json(results);
});

async function raceExists(db: D1Database, id: string) {
  return db.prepare("SELECT 1 FROM races WHERE id = ?").bind(id).first();
}

app.get("/api/races/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT id, name, expires_at AS expiresAt FROM races WHERE id = ?")
    .bind(c.req.param("id"))
    .first<RaceSummary>();
  return row ? c.json(row) : c.json({ error: "not_found" }, 404);
});

app.get("/api/races/:id/state", async (c) => {
  const id = c.req.param("id");
  if (!(await raceExists(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  return c.env.RACE.get(c.env.RACE.idFromName(id)).fetch("http://do/state");
});

app.get("/api/races/:id/ws", async (c) => {
  const id = c.req.param("id");
  if (!(await raceExists(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  return c.env.RACE.get(c.env.RACE.idFromName(id)).fetch("http://do/ws", c.req.raw);
});

// Local development only: set a race's live state until the steward panel exists.
app.put("/api/dev/races/:id/state", async (c) => {
  if (c.env.DEV !== "1") return c.json({ error: "not_found" }, 404);
  const stub = c.env.RACE.get(c.env.RACE.idFromName(c.req.param("id")));
  return stub.fetch("http://do/state", { method: "PUT", body: await c.req.text() });
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
