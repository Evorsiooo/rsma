import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AdminRace, AdminUser, Me, Role } from "../shared/types";
import { getMe, hasRole, type AuthEnv } from "./auth";
import { SESSION_COOKIE } from "./auth/session";

interface AdminEnv extends AuthEnv {
  /** Local development only: point username lookups at a mock server. */
  ROBLOX_USERS_BASE?: string;
}
type C = Context<{ Bindings: AdminEnv; Variables: { me: Me } }>;

const ROLES: Role[] = ["admin", "users", "races", "steward"];

export const admin = new Hono<{ Bindings: AdminEnv; Variables: { me: Me } }>();

const guard = (...roles: Role[]) => async (c: C, next: () => Promise<void>) => {
  const me = await getMe(c.env, getCookie(c, SESSION_COOKIE));
  if (!me) return c.json({ error: "unauthorized" }, 401);
  if (!hasRole(me, ...roles)) return c.json({ error: "forbidden" }, 403);
  c.set("me", me);
  await next();
};

/** Find a user by Roblox username, creating the record from Roblox when they have not signed in yet. */
async function resolveUser(env: AdminEnv, username: string): Promise<{ id: string; username: string } | null> {
  const local = await env.DB.prepare("SELECT roblox_id AS id, username FROM users WHERE lower(username) = lower(?)")
    .bind(username)
    .first<{ id: string; username: string }>();
  if (local) return local;
  const res = await fetch(`${env.ROBLOX_USERS_BASE ?? "https://users.roblox.com"}/v1/usernames/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const hit = ((await res.json()) as { data?: { id: number; name: string; displayName: string }[] }).data?.[0];
  if (!hit) return null;
  await env.DB.prepare("INSERT OR IGNORE INTO users (roblox_id, username, display_name, created_at) VALUES (?, ?, ?, ?)")
    .bind(String(hit.id), hit.name, hit.displayName, Date.now())
    .run();
  return { id: String(hit.id), username: hit.name };
}

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
const cleanUsername = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_]{3,20}$/.test(v.trim()) ? v.trim() : "");

// ---- Users ----------------------------------------------------------------

admin.get("/users", guard("users"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.roblox_id AS id, u.username, u.display_name AS displayName, u.last_login AS lastLogin,
            COALESCE((SELECT group_concat(role) FROM user_roles r WHERE r.roblox_id = u.roblox_id), '') AS roles
     FROM users u ORDER BY lower(u.username)`,
  ).all<Omit<AdminUser, "roles"> & { roles: string }>();
  return c.json(results.map((u) => ({ ...u, roles: u.roles ? (u.roles.split(",") as Role[]) : [] })) satisfies AdminUser[]);
});

admin.post("/users", guard("users"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown };
  const username = cleanUsername(body.username);
  if (!username) return c.json({ error: "invalid_username" }, 400);
  const user = await resolveUser(c.env, username);
  return user ? c.json(user) : c.json({ error: "no_such_roblox_user" }, 404);
});

admin.put("/users/:id/roles", guard("users"), async (c) => {
  const me = c.get("me");
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { roles?: unknown };
  if (!Array.isArray(body.roles) || !body.roles.every((r) => ROLES.includes(r as Role))) return c.json({ error: "invalid" }, 400);
  const roles = [...new Set(body.roles as Role[])];
  const current = (
    await c.env.DB.prepare("SELECT role FROM user_roles WHERE roblox_id = ?").bind(id).all<{ role: Role }>()
  ).results.map((r) => r.role);
  if (!(await c.env.DB.prepare("SELECT 1 FROM users WHERE roblox_id = ?").bind(id).first())) return c.json({ error: "not_found" }, 404);
  // Only admins may grant or revoke admin.
  const adminChanged = roles.includes("admin") !== current.includes("admin");
  if (adminChanged && !me.roles.includes("admin")) return c.json({ error: "forbidden" }, 403);
  // Never leave the site without an admin.
  if (current.includes("admin") && !roles.includes("admin")) {
    const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'").first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) return c.json({ error: "last_admin" }, 409);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_roles WHERE roblox_id = ?").bind(id),
    ...roles.map((r) => c.env.DB.prepare("INSERT INTO user_roles (roblox_id, role) VALUES (?, ?)").bind(id, r)),
  ]);
  return c.json({ ok: true });
});

// ---- Races ----------------------------------------------------------------

async function loadRaces(env: AdminEnv): Promise<AdminRace[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, status, expires_at AS expiresAt FROM races ORDER BY status ASC, expires_at DESC",
  ).all<Omit<AdminRace, "stewards">>();
  const stew = (
    await env.DB.prepare(
      "SELECT s.race_id AS raceId, u.roblox_id AS id, u.username FROM race_stewards s JOIN users u ON u.roblox_id = s.roblox_id ORDER BY lower(u.username)",
    ).all<{ raceId: string; id: string; username: string }>()
  ).results;
  return results.map((r) => ({ ...r, stewards: stew.filter((s) => s.raceId === r.id).map(({ id, username }) => ({ id, username })) }));
}

admin.get("/races", guard("races"), async (c) => c.json(await loadRaces(c.env)));

admin.post("/races", guard("races"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; expiresAt?: unknown };
  const name = cleanName(body.name);
  const expiresAt = Number(body.expiresAt);
  const now = Date.now();
  if (!name || !Number.isFinite(expiresAt) || expiresAt <= now) return c.json({ error: "invalid" }, 400);
  const id = `race_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await c.env.DB.prepare("INSERT INTO races (id, name, status, expires_at, created_at) VALUES (?, ?, 'active', ?, ?)")
    .bind(id, name, expiresAt, now)
    .run();
  return c.json({ id });
});

admin.patch("/races/:id", guard("races"), async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; expiresAt?: unknown; status?: unknown };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return c.json({ error: "invalid" }, 400);
    sets.push("name = ?");
    vals.push(name);
  }
  if (body.expiresAt !== undefined) {
    const t = Number(body.expiresAt);
    if (!Number.isFinite(t) || t <= 0) return c.json({ error: "invalid" }, 400);
    sets.push("expires_at = ?");
    vals.push(t);
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "archived") return c.json({ error: "invalid" }, 400);
    sets.push("status = ?");
    vals.push(body.status);
  }
  if (!sets.length) return c.json({ error: "invalid" }, 400);
  const res = await c.env.DB.prepare(`UPDATE races SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

admin.post("/races/:id/stewards", guard("races"), async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown };
  const username = cleanUsername(body.username);
  if (!username) return c.json({ error: "invalid_username" }, 400);
  if (!(await c.env.DB.prepare("SELECT 1 FROM races WHERE id = ?").bind(id).first())) return c.json({ error: "not_found" }, 404);
  const user = await resolveUser(c.env, username);
  if (!user) return c.json({ error: "no_such_roblox_user" }, 404);
  await c.env.DB.prepare("INSERT OR IGNORE INTO race_stewards (race_id, roblox_id) VALUES (?, ?)").bind(id, user.id).run();
  return c.json(user);
});

admin.delete("/races/:id/stewards/:uid", guard("races"), async (c) => {
  await c.env.DB.prepare("DELETE FROM race_stewards WHERE race_id = ? AND roblox_id = ?")
    .bind(c.req.param("id"), c.req.param("uid"))
    .run();
  return c.json({ ok: true });
});

// ---- System ---------------------------------------------------------------

admin.get("/system", guard("admin"), async (c) => {
  const n = async (sql: string, ...b: unknown[]) => (await c.env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n ?? 0;
  const now = Date.now();
  return c.json({
    users: await n("SELECT COUNT(*) AS n FROM users"),
    admins: await n("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'"),
    activeRaces: await n("SELECT COUNT(*) AS n FROM races WHERE status = 'active' AND expires_at > ?", now),
    expiredRaces: await n("SELECT COUNT(*) AS n FROM races WHERE status = 'active' AND expires_at <= ?", now),
    archivedRaces: await n("SELECT COUNT(*) AS n FROM races WHERE status = 'archived'"),
    robloxConfigured: !!(c.env.ROBLOX_CLIENT_ID && c.env.ROBLOX_CLIENT_SECRET && c.env.SESSION_SECRET),
  });
});
