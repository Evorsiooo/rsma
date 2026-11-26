import { Hono, type MiddlewareHandler } from "hono";
import type { Me } from "../shared/types";
import { segmentLabel, segmentsOf, validateGeometry, type TrackGeometry } from "../shared/track";
import type { AdminEnv } from "./admin";

/** The tracing guide is a JPEG shrunk in the browser; this is the most one track may hold. */
export const MAX_IMAGE = 700_000;

interface Row {
  id: string;
  name: string;
  version: number;
  geometry: string;
  image: string | null;
  updatedAt: number;
}

const COLS = "id, name, version, geometry, image, updated_at AS updatedAt";
const parse = (r: Row): TrackGeometry | null => {
  try {
    return validateGeometry(JSON.parse(r.geometry));
  } catch {
    return null;
  }
};

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
const cleanImage = (v: unknown): string | null | "invalid" => {
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" && v.length <= MAX_IMAGE && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v) ? v : "invalid";
};

/** Public: the drawing of one track, for the maps on the timing page and in the panels. */
export const tracks = new Hono<{ Bindings: AdminEnv }>();
tracks.get("/:id", async (c) => {
  const r = await c.env.DB.prepare(`SELECT ${COLS} FROM tracks WHERE id = ?`).bind(c.req.param("id")).first<Row>();
  const geometry = r && parse(r);
  if (!r || !geometry) return c.json({ error: "not_found" }, 404);
  return c.json({ id: r.id, name: r.name, version: r.version, geometry });
});

/** Admin routes under /api/admin/tracks, behind the races role. */
export function mountTracksAdmin(app: Hono<{ Bindings: AdminEnv; Variables: { me: Me } }>, g: MiddlewareHandler) {
  app.get("/tracks", g, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT ${COLS}, (SELECT COUNT(*) FROM races WHERE track_id = tracks.id) AS events FROM tracks ORDER BY lower(name)`,
    ).all<Row & { events: number }>();
    return c.json(
      results.map((r) => {
        const geometry = parse(r);
        return { id: r.id, name: r.name, version: r.version, events: r.events, segments: geometry ? segmentsOf(geometry).length : 0, turns: geometry?.turns.length ?? 0 };
      }),
    );
  });

  app.get("/tracks/:id", g, async (c) => {
    const r = await c.env.DB.prepare(`SELECT ${COLS} FROM tracks WHERE id = ?`).bind(c.req.param("id")).first<Row>();
    const geometry = r && parse(r);
    if (!r || !geometry) return c.json({ error: "not_found" }, 404);
    return c.json({ id: r.id, name: r.name, version: r.version, geometry, image: r.image });
  });

  app.post("/tracks", g, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; geometry?: unknown; image?: unknown };
    const name = cleanName(body.name);
    const geometry = validateGeometry(body.geometry);
    const image = cleanImage(body.image);
    if (!name || !geometry || image === "invalid") return c.json({ error: "invalid" }, 400);
    if (await c.env.DB.prepare("SELECT 1 FROM tracks WHERE name = ?").bind(name).first()) return c.json({ error: "name_taken" }, 409);
    const id = `trk_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const now = Date.now();
    await c.env.DB.prepare("INSERT INTO tracks (id, name, version, geometry, image, created_at, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?, ?, ?)")
      .bind(id, name, JSON.stringify(geometry), image, now, now, c.get("me").username)
      .run();
    return c.json({ id });
  });

  app.put("/tracks/:id", g, async (c) => {
    const id = c.req.param("id") ?? "";
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; geometry?: unknown; image?: unknown };
    const name = cleanName(body.name);
    const geometry = validateGeometry(body.geometry);
    const image = cleanImage(body.image);
    if (!name || !geometry || image === "invalid") return c.json({ error: "invalid" }, 400);
    if (await c.env.DB.prepare("SELECT 1 FROM tracks WHERE name = ? AND id <> ?").bind(name, id).first()) return c.json({ error: "name_taken" }, 409);
    const res = await c.env.DB.prepare("UPDATE tracks SET name = ?, geometry = ?, image = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?")
      .bind(name, JSON.stringify(geometry), image, Date.now(), c.get("me").username, id)
      .run();
    return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  app.delete("/tracks/:id", g, async (c) => {
    const id = c.req.param("id") ?? "";
    if (await c.env.DB.prepare("SELECT 1 FROM races WHERE track_id = ?").bind(id).first()) return c.json({ error: "in_use" }, 409);
    const res = await c.env.DB.prepare("DELETE FROM tracks WHERE id = ?").bind(id).run();
    return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });
}

/** The radio wording for a segment of an event's track ("turns 3 to 4"), or null when the event has no such segment. */
export async function segmentLabelOf(db: D1Database, trackId: string | null, seg: unknown): Promise<string | null> {
  if (!trackId || typeof seg !== "string") return null;
  const r = await db.prepare(`SELECT ${COLS} FROM tracks WHERE id = ?`).bind(trackId).first<Row>();
  const g = r && parse(r);
  const s = g && segmentsOf(g).find((x) => x.id === seg);
  return g && s ? segmentLabel(g, s) : null;
}
