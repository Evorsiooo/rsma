import { Hono } from "hono";
import type { RaceSummary } from "../shared/types";

interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

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

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
