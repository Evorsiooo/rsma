import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AdminRace, AdminTeam, AdminUser, Me, Role, SessionSummary, SessionType, TeamKind } from "../shared/types";
import { cleanRoles, parseRoles, type TeamRole } from "../shared/teams";
import { getMe, hasRole, type AuthEnv } from "./auth";
import { SESSION_COOKIE } from "./auth/session";
import { sessionsOf } from "./sessions";
import { resolveUserId } from "./roblox-users";
import { rootOf } from "./registration";
import { regSessionsOf, syncRegistered, syncSessions } from "./stage";
import { issueCode, revokeCode, setTokenMode, tokenMode } from "./access-codes";
import { formatDiscordStewardMessage, getDiscordWebhook, sendDiscordWebhook, setDiscordWebhook } from "./discord";

export interface AdminEnv extends AuthEnv {
  /** Local development only: point username lookups at a mock server. */
  RACE: DurableObjectNamespace;
  ROBLOX_USERS_BASE?: string;
  ROBLOX_WWW_BASE?: string;
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

/** Resolve a Roblox username to a user we hold by Roblox ID, or the error response to send. */
export async function resolveUser(c: { env: AdminEnv; json: (b: { error: string }, status: 404 | 503) => Response }, username: string): Promise<{ id: string; username: string } | Response> {
  const r = await resolveUserId(c.env, username);
  if ("user" in r) return r.user;
  return c.json({ error: r.error }, r.error === "lookup_failed" ? 503 : 404);
}

const newSessionId = () => `ses_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const SESSION_TYPES: SessionType[] = ["practice", "timed", "race"];

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
export const cleanUsername = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_]{3,20}$/.test(v.trim()) ? v.trim() : "");

// ---- Users ----------------------------------------------------------------

admin.get("/users", guard("users"), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.roblox_id AS id, u.username, u.display_name AS displayName, u.last_login AS lastLogin,
            COALESCE((SELECT group_concat(role) FROM user_roles r WHERE r.roblox_id = u.roblox_id), '') AS roles,
            a.created_at AS codeAt, a.last_used AS codeUsed
     FROM users u LEFT JOIN access_codes a ON a.roblox_id = u.roblox_id ORDER BY lower(u.username)`,
  ).all<Omit<AdminUser, "roles" | "code"> & { roles: string; codeAt: number | null; codeUsed: number | null }>();
  return c.json(
    results.map(({ codeAt, codeUsed, ...u }) => ({
      ...u,
      roles: u.roles ? (u.roles.split(",") as Role[]) : [],
      code: codeAt == null ? null : { at: codeAt, lastUsed: codeUsed },
    })) satisfies AdminUser[],
  );
});

admin.post("/users", guard("users"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown };
  const username = cleanUsername(body.username);
  if (!username) return c.json({ error: "invalid_username" }, 400);
  const user = await resolveUser(c, username);
  return user instanceof Response ? user : c.json(user);
});

admin.put("/system/token-mode", guard("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { on?: unknown };
  if (typeof body.on !== "boolean") return c.json({ error: "invalid" }, 400);
  await setTokenMode(c.env.DB, body.on);
  return c.json({ ok: true });
});

admin.put("/system/discord-webhook", guard("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== "string") return c.json({ error: "invalid" }, 400);
  const url = body.url.trim();
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return c.json({ error: "invalid_url" }, 400);
    } catch {
      return c.json({ error: "invalid_url" }, 400);
    }
  }
  await setDiscordWebhook(c.env.DB, url);
  return c.json({ ok: true });
});

admin.post("/system/discord-webhook/test", guard("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
  let url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    url = (await getDiscordWebhook(c.env.DB)) ?? "";
  }
  if (!url) return c.json({ error: "no_webhook" }, 400);
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return c.json({ error: "invalid_url" }, 400);
  } catch {
    return c.json({ error: "invalid_url" }, 400);
  }
  const ok = await sendDiscordWebhook(url, formatDiscordStewardMessage("Test message"));
  if (!ok) return c.json({ error: "delivery_failed" }, 400);
  return c.json({ ok: true });
});

/** A new access code for anyone we hold, including people who never signed in. The old code stops working. */
admin.post("/users/:id/code", guard("admin"), async (c) => {
  const id = c.req.param("id") ?? "";
  if (!(await c.env.DB.prepare("SELECT 1 FROM users WHERE roblox_id = ?").bind(id).first())) return c.json({ error: "not_found" }, 404);
  return c.json(await issueCode(c.env, id, c.get("me").id));
});

admin.delete("/users/:id/code", guard("admin"), async (c) => {
  await revokeCode(c.env.DB, c.req.param("id") ?? "");
  return c.json({ ok: true });
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
  const user = await resolveUser(c, username);
  if (user instanceof Response) return user;
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
  const cur = await c.env.DB.prepare("SELECT name, type, starts_at AS startsAt, ends_at AS endsAt, self_timed AS selfTimed, staging FROM sessions WHERE id = ?").bind(id).first<Pick<SessionSummary, "name" | "type" | "startsAt" | "endsAt"> & { selfTimed: number; staging: number }>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; type?: unknown; startsAt?: unknown; endsAt?: unknown; selfTimed?: unknown; staging?: unknown };
  const name = body.name !== undefined ? cleanName(body.name) : cur.name;
  const type = body.type !== undefined ? (body.type as SessionType) : cur.type;
  const startsAt = body.startsAt !== undefined ? Number(body.startsAt) : cur.startsAt;
  const endsAt = body.endsAt !== undefined ? Number(body.endsAt) : cur.endsAt;
  if (!name || !SESSION_TYPES.includes(type)) return c.json({ error: "invalid" }, 400);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return c.json({ error: "invalid_times" }, 400);
  const staging = body.staging !== undefined ? body.staging === true : !!cur.staging;
  const selfTimed = type === "practice" && (body.selfTimed !== undefined ? body.selfTimed === true : !!cur.selfTimed);
  await c.env.DB.prepare("UPDATE sessions SET name = ?, type = ?, starts_at = ?, ends_at = ?, self_timed = ?, staging = ? WHERE id = ?").bind(name, type, startsAt, endsAt, selfTimed ? 1 : 0, staging ? 1 : 0, id).run();
  return c.json({ ok: true });
});

admin.delete("/sessions/:id", guard("races"), async (c) => {
  const sid = c.req.param("id") ?? "";
  const followers = await followersOf(c.env, sid);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE session_registration SET follows = NULL WHERE follows = ?").bind(sid),
    c.env.DB.prepare("DELETE FROM registrations WHERE session_id = ?").bind(sid),
    c.env.DB.prepare("DELETE FROM session_registration WHERE session_id = ?").bind(sid),
    c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid),
  ]);
  await syncSessions(c.env, followers);
  return c.json({ ok: true });
});

/** Sessions linked directly to this one's registration. */
async function followersOf(env: AdminEnv, sid: string): Promise<string[]> {
  return (await env.DB.prepare("SELECT session_id AS id FROM session_registration WHERE follows = ?").bind(sid).all<{ id: string }>()).results.map((r) => r.id);
}

/** Registration settings for a session: window, spots per kind, factory reserve, independents, and the session it shares registration with. */
admin.put("/sessions/:id/registration", guard("races"), async (c) => {
  const id = c.req.param("id") ?? "";
  if (!(await c.env.DB.prepare("SELECT 1 FROM sessions WHERE id = ?").bind(id).first())) return c.json({ error: "not_found" }, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 999 ? (v as number) : null);
  const follows = typeof b.follows === "string" && b.follows ? b.follows : null;
  let opensAt = Number(b.opensAt);
  let deadline = Number(b.deadline);
  if (follows) {
    // Linked: the first session of the group sets the window, and the group must be in the same race with no loop.
    const same = await c.env.DB.prepare("SELECT 1 FROM sessions a JOIN sessions b ON a.race_id = b.race_id WHERE a.id = ? AND b.id = ?").bind(id, follows).first();
    const head = await rootOf(c.env, follows);
    let loop = follows === id;
    for (let cur: string | null | undefined = follows, i = 0; cur && !loop && i < 20; i++) {
      cur = (await c.env.DB.prepare("SELECT follows FROM session_registration WHERE session_id = ?").bind(cur).first<{ follows: string | null }>())?.follows;
      loop = cur === id;
    }
    const w = await c.env.DB.prepare("SELECT opens_at AS opensAt, deadline FROM session_registration WHERE session_id = ?").bind(head).first<{ opensAt: number; deadline: number }>();
    if (!same || !w || loop) return c.json({ error: "invalid_link" }, 400);
    if (await c.env.DB.prepare("SELECT 1 FROM registrations WHERE session_id = ?").bind(id).first()) return c.json({ error: "has_registrations" }, 409);
    ({ opensAt, deadline } = w);
  }
  const [drivers, employees, spectators, reserved] = [num(b.drivers), num(b.employees), num(b.spectators), num(b.factoryReserved)];
  if (!Number.isFinite(opensAt) || !Number.isFinite(deadline) || deadline <= opensAt) return c.json({ error: "invalid_times" }, 400);
  const teamCap = b.teamCap === null || b.teamCap === undefined ? null : num(b.teamCap);
  if (drivers === null || employees === null || spectators === null || reserved === null || (b.teamCap != null && teamCap === null)) return c.json({ error: "invalid" }, 400);
  await c.env.DB.prepare(
    `INSERT INTO session_registration (session_id, opens_at, deadline, drivers, employees, spectators, factory_reserved, independents, follows, team_cap)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(session_id) DO UPDATE SET opens_at = ?2, deadline = ?3, drivers = ?4, employees = ?5, spectators = ?6, factory_reserved = ?7, independents = ?8, follows = ?9, team_cap = ?10`,
  )
    .bind(id, opensAt, deadline, drivers, employees, spectators, reserved, b.independents === true ? 1 : 0, follows, teamCap)
    .run();
  await syncRegistered(c.env, id);
  return c.json({ ok: true });
});

/** Turn registration off for a session and clear what was entered. Sessions that followed it keep their own settings, unlinked. */
admin.delete("/sessions/:id/registration", guard("races"), async (c) => {
  const id = c.req.param("id") ?? "";
  const followers = await followersOf(c.env, id);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE session_registration SET follows = NULL WHERE follows = ?").bind(id),
    c.env.DB.prepare("DELETE FROM registrations WHERE session_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM session_registration WHERE session_id = ?").bind(id),
  ]);
  await syncSessions(c.env, followers);
  return c.json({ ok: true });
});

// ---- Teams (temporary until team registration) -------------------------------

admin.get("/teams", guard("users"), async (c) => {
  const { results: rows } = await c.env.DB.prepare("SELECT id, name, kind, car, factory_id AS factoryId FROM teams ORDER BY lower(name)").all<{ id: string; name: string; kind: TeamKind; car: string | null; factoryId: string | null }>();
  const results = rows.map((t) => ({ ...t, factoryName: rows.find((f) => f.id === t.factoryId)?.name ?? null }));
  const members = (
    await c.env.DB.prepare(
      "SELECT m.team_id AS teamId, u.roblox_id AS id, u.username, m.roles FROM team_members m JOIN users u ON u.roblox_id = m.roblox_id ORDER BY lower(u.username)",
    ).all<{ teamId: string; id: string; username: string; roles: string }>()
  ).results;
  return c.json(results.map((t) => ({ ...t, members: members.filter((m) => m.teamId === t.id).map(({ id, username, roles }) => ({ id, username, roles: parseRoles(roles) })) })) satisfies AdminTeam[]);
});

/** Factory teams need a car; customer teams need the factory team whose car they run. */
async function teamKindFields(env: AdminEnv, body: { kind?: unknown; car?: unknown; factoryId?: unknown }, selfId?: string) {
  if (body.kind === "customer") {
    const factoryId = typeof body.factoryId === "string" ? body.factoryId : "";
    const f = factoryId && factoryId !== selfId ? await env.DB.prepare("SELECT 1 FROM teams WHERE id = ? AND kind = 'factory'").bind(factoryId).first() : null;
    return f ? { kind: "customer" as const, car: null, factoryId } : null;
  }
  const car = cleanName(body.car).slice(0, 40);
  return body.kind === "factory" && car ? { kind: "factory" as const, car, factoryId: null } : null;
}

admin.post("/teams", guard("users"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; kind?: unknown; car?: unknown; factoryId?: unknown };
  const name = cleanName(body.name).slice(0, 40);
  const k = await teamKindFields(c.env, body);
  if (!name || !k) return c.json({ error: "invalid" }, 400);
  const id = `team_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try {
    await c.env.DB.prepare("INSERT INTO teams (id, name, created_at, kind, car, factory_id) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, Date.now(), k.kind, k.car, k.factoryId).run();
  } catch {
    return c.json({ error: "name_taken" }, 409);
  }
  return c.json({ id });
});

admin.patch("/teams/:id", guard("users"), async (c) => {
  const id = c.req.param("id") ?? "";
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; kind?: unknown; car?: unknown; factoryId?: unknown };
  const cur = await c.env.DB.prepare("SELECT name, kind FROM teams WHERE id = ?").bind(id).first<{ name: string; kind: string }>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const name = body.name !== undefined ? cleanName(body.name).slice(0, 40) : cur.name;
  const k = await teamKindFields(c.env, body, id);
  if (!name || !k) return c.json({ error: "invalid" }, 400);
  if (k.kind === "customer" && (await c.env.DB.prepare("SELECT 1 FROM teams WHERE factory_id = ?").bind(id).first())) return c.json({ error: "has_customers" }, 409);
  try {
    await c.env.DB.prepare("UPDATE teams SET name = ?, kind = ?, car = ?, factory_id = ? WHERE id = ?").bind(name, k.kind, k.car, k.factoryId, id).run();
  } catch {
    return c.json({ error: "name_taken" }, 409);
  }
  return c.json({ ok: true });
});

admin.delete("/teams/:id", guard("users"), async (c) => {
  if (await c.env.DB.prepare("SELECT 1 FROM teams WHERE factory_id = ?").bind(c.req.param("id")).first()) return c.json({ error: "has_customers" }, 409);
  const sessions = await regSessionsOf(c.env, c.req.param("id") ?? "");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM registrations WHERE team_id = ?").bind(c.req.param("id")),
    c.env.DB.prepare("DELETE FROM teams WHERE id = ?").bind(c.req.param("id")),
  ]);
  await syncSessions(c.env, sessions);
  return c.json({ ok: true });
});

/** Only one Team Principal per team. */
async function principalTaken(env: AdminEnv, teamId: string, exceptUser: string) {
  const { results } = await env.DB.prepare("SELECT roblox_id AS id, roles FROM team_members WHERE team_id = ?").bind(teamId).all<{ id: string; roles: string }>();
  return results.some((m) => m.id !== exceptUser && parseRoles(m.roles).includes("principal"));
}

admin.post("/teams/:id/members", guard("users"), async (c) => {
  const id = c.req.param("id") ?? "";
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; roles?: unknown };
  const username = cleanUsername(body.username);
  if (!username) return c.json({ error: "invalid_username" }, 400);
  const roles = body.roles === undefined ? (["driver"] as TeamRole[]) : cleanRoles(body.roles);
  if (!roles) return c.json({ error: "invalid_roles" }, 400);
  if (!(await c.env.DB.prepare("SELECT 1 FROM teams WHERE id = ?").bind(id).first())) return c.json({ error: "not_found" }, 404);
  const user = await resolveUser(c, username);
  if (user instanceof Response) return user;
  if (roles.includes("principal") && (await principalTaken(c.env, id, user.id))) return c.json({ error: "has_principal" }, 409);
  await c.env.DB.prepare("INSERT OR IGNORE INTO team_members (team_id, roblox_id, roles) VALUES (?, ?, ?)").bind(id, user.id, roles.join(",")).run();
  return c.json(user);
});

admin.put("/teams/:id/members/:uid/roles", guard("users"), async (c) => {
  const id = c.req.param("id") ?? "";
  const uid = c.req.param("uid") ?? "";
  const body = (await c.req.json().catch(() => ({}))) as { roles?: unknown };
  const roles = cleanRoles(body.roles);
  if (!roles) return c.json({ error: "invalid_roles" }, 400);
  if (!(await c.env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND roblox_id = ?").bind(id, uid).first())) return c.json({ error: "not_found" }, 404);
  if (roles.includes("principal") && (await principalTaken(c.env, id, uid))) return c.json({ error: "has_principal" }, 409);
  await c.env.DB.prepare("UPDATE team_members SET roles = ? WHERE team_id = ? AND roblox_id = ?").bind(roles.join(","), id, uid).run();
  return c.json({ ok: true });
});

admin.delete("/teams/:id/members/:uid", guard("users"), async (c) => {
  const sessions = await regSessionsOf(c.env, c.req.param("id") ?? "", c.req.param("uid") ?? "");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND roblox_id = ?").bind(c.req.param("id"), c.req.param("uid")),
    c.env.DB.prepare("DELETE FROM registrations WHERE team_id = ? AND roblox_id = ? AND kind != 'spectator'").bind(c.req.param("id"), c.req.param("uid")),
  ]);
  await syncSessions(c.env, sessions);
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
    tokenMode: await tokenMode(c.env.DB),
    discordWebhook: (await getDiscordWebhook(c.env.DB)) ?? "",
    robloxConfigured: !!(c.env.ROBLOX_CLIENT_ID && c.env.ROBLOX_CLIENT_SECRET && c.env.SESSION_SECRET),
  });
});
