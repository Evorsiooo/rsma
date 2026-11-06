import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AdminRace, AdminTeam, AdminUser, Me, Role, SessionSummary, SessionType } from "../shared/types";
import { getMe, hasRole, type AuthEnv } from "./auth";
import { SESSION_COOKIE } from "./auth/session";
import { sessionsOf } from "./sessions";

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

const newSessionId = () => `ses_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const SESSION_TYPES: SessionType[] = ["practice", "timed", "race"];

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
  ).all<Omit<AdminRace, "stewards" | "sessions">>();
  const sessions = await sessionsOf(env.DB, results.map((r) => r.id));
  const stew = (
    await env.DB.prepare(
      "SELECT s.race_id AS raceId, u.roblox_id AS id, u.username FROM race_stewards s JOIN users u ON u.roblox_id = s.roblox_id ORDER BY lower(u.username)",
    ).all<{ raceId: string; id: string; username: string }>()
  ).results;
  return results.map((r) => ({ ...r, sessions: sessions.get(r.id) ?? [], stewards: stew.filter((s) => s.raceId === r.id).map(({ id, username }) => ({ id, username })) }));
}

admin.get("/races", guard("races"), async (c) => c.json(await loadRaces(c.env)));

admin.post("/races", guard("races"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; expiresAt?: unknown };
  const name = cleanName(body.name);
  const expiresAt = Number(body.expiresAt);
  const now = Date.now();
  if (!name || !Number.isFinite(expiresAt) || expiresAt <= now) return c.json({ error: "invalid" }, 400);
  const id = `race_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  // A new event starts with one timed event session running until it expires; edit or add sessions afterwards.
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO races (id, name, status, expires_at, created_at) VALUES (?, ?, 'active', ?, ?)").bind(id, name, expiresAt, now),
    c.env.DB.prepare(
      "INSERT INTO sessions (id, race_id, name, type, position, starts_at, ends_at, created_at) VALUES (?, ?, 'Timed event', 'timed', 0, ?, ?, ?)",
    ).bind(newSessionId(), id, now, expiresAt, now),
  ]);
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

// ---- Sessions -------------------------------------------------------------

/** Next default name: "Practice 3", or "Timed event" for the first of that type. */
async function defaultName(env: AdminEnv, raceId: string, type: SessionType) {
  const label = type === "practice" ? "Practice" : type === "timed" ? "Timed event" : "Race";
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE race_id = ? AND type = ?").bind(raceId, type).first<{ n: number }>())?.n ?? 0;
  return type === "practice" || n > 0 ? `${label} ${n + 1}` : label;
}

admin.post("/races/:id/sessions", guard("races"), async (c) => {
  const raceId = c.req.param("id") ?? "";
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; type?: unknown; startsAt?: unknown; endsAt?: unknown; selfTimed?: unknown };
  if (!SESSION_TYPES.includes(body.type as SessionType)) return c.json({ error: "invalid" }, 400);
  const type = body.type as SessionType;
  if (type === "race") return c.json({ error: "race_disabled" }, 400);
  const startsAt = Number(body.startsAt);
  const endsAt = Number(body.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return c.json({ error: "invalid_times" }, 400);
  if (!(await c.env.DB.prepare("SELECT 1 FROM races WHERE id = ?").bind(raceId).first())) return c.json({ error: "not_found" }, 404);
  const name = cleanName(body.name) || (await defaultName(c.env, raceId, type));
  const pos = ((await c.env.DB.prepare("SELECT MAX(position) AS m FROM sessions WHERE race_id = ?").bind(raceId).first<{ m: number | null }>())?.m ?? -1) + 1;
  const id = newSessionId();
  await c.env.DB.prepare("INSERT INTO sessions (id, race_id, name, type, position, starts_at, ends_at, created_at, self_timed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, raceId, name, type, pos, startsAt, endsAt, Date.now(), type === "practice" && body.selfTimed === true ? 1 : 0)
    .run();
  return c.json({ id });
});

admin.patch("/sessions/:id", guard("races"), async (c) => {
  const id = c.req.param("id");
  const cur = await c.env.DB.prepare("SELECT name, type, starts_at AS startsAt, ends_at AS endsAt, self_timed AS selfTimed FROM sessions WHERE id = ?").bind(id).first<Pick<SessionSummary, "name" | "type" | "startsAt" | "endsAt"> & { selfTimed: number }>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; type?: unknown; startsAt?: unknown; endsAt?: unknown; selfTimed?: unknown };
  const name = body.name !== undefined ? cleanName(body.name) : cur.name;
  const type = body.type !== undefined ? (body.type as SessionType) : cur.type;
  const startsAt = body.startsAt !== undefined ? Number(body.startsAt) : cur.startsAt;
  const endsAt = body.endsAt !== undefined ? Number(body.endsAt) : cur.endsAt;
  if (!name || !SESSION_TYPES.includes(type)) return c.json({ error: "invalid" }, 400);
  if (type === "race" && cur.type !== "race") return c.json({ error: "race_disabled" }, 400);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return c.json({ error: "invalid_times" }, 400);
  const selfTimed = type === "practice" && (body.selfTimed !== undefined ? body.selfTimed === true : !!cur.selfTimed);
  await c.env.DB.prepare("UPDATE sessions SET name = ?, type = ?, starts_at = ?, ends_at = ?, self_timed = ? WHERE id = ?").bind(name, type, startsAt, endsAt, selfTimed ? 1 : 0, id).run();
  return c.json({ ok: true });
});

admin.delete("/sessions/:id", guard("races"), async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---- Teams (temporary until team registration) -------------------------------

admin.get("/teams", guard("users"), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name FROM teams ORDER BY lower(name)").all<{ id: string; name: string }>();
  const members = (
    await c.env.DB.prepare(
      "SELECT m.team_id AS teamId, u.roblox_id AS id, u.username FROM team_members m JOIN users u ON u.roblox_id = m.roblox_id ORDER BY lower(u.username)",
    ).all<{ teamId: string; id: string; username: string }>()
  ).results;
  return c.json(results.map((t) => ({ ...t, members: members.filter((m) => m.teamId === t.id).map(({ id, username }) => ({ id, username })) })) satisfies AdminTeam[]);
});

admin.post("/teams", guard("users"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = cleanName(body.name).slice(0, 40);
  if (!name) return c.json({ error: "invalid" }, 400);
  const id = `team_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try {
    await c.env.DB.prepare("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, Date.now()).run();
  } catch {
    return c.json({ error: "name_taken" }, 409);
  }
  return c.json({ id });
});

admin.delete("/teams/:id", guard("users"), async (c) => {
  await c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

admin.post("/teams/:id/members", guard("users"), async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown };
  const username = cleanUsername(body.username);
  if (!username) return c.json({ error: "invalid_username" }, 400);
  if (!(await c.env.DB.prepare("SELECT 1 FROM teams WHERE id = ?").bind(id).first())) return c.json({ error: "not_found" }, 404);
  const user = await resolveUser(c.env, username);
  if (!user) return c.json({ error: "no_such_roblox_user" }, 404);
  await c.env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, roblox_id) VALUES (?, ?)").bind(id, user.id).run();
  return c.json(user);
});

admin.delete("/teams/:id/members/:uid", guard("users"), async (c) => {
  await c.env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND roblox_id = ?").bind(c.req.param("id"), c.req.param("uid")).run();
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
