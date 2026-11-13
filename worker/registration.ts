import { canIssueFor, hit, issueCode, tokenMode } from "./access-codes";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Me } from "../shared/types";
import {
  computeCut,
  eligibleFor,
  GROUP_STATUSES,
  REG_KINDS,
  regPhase,
  type GroupStatus,
  type RegKind,
  type RegGroupMember,
  type Registration,
  type RegistrationView,
  type RegSummary,
  type RegSettings,
  type RegTeam,
} from "../shared/registration";
import { hasAny, MANAGER_ROLES, PANEL_ROLES, parseRoles } from "../shared/teams";
import { getMe, hasRole } from "./auth";
import { SESSION_COOKIE } from "./auth/session";
import { syncRegistered } from "./stage";
import { cleanUsername, resolveUser, type AdminEnv } from "./admin";

type E = { Bindings: AdminEnv; Variables: { me: Me | null } };
type C = Context<E>;

export const registration = new Hono<E>();

registration.use("*", async (c, next) => {
  c.set("me", await getMe(c.env, getCookie(c, SESSION_COOKIE)));
  await next();
});

interface SettingsRow {
  opensAt: number;
  deadline: number;
  drivers: number;
  employees: number;
  spectators: number;
  factoryReserved: number;
  independents: number;
  teamCap: number | null;
  follows: string | null;
}

/** The session whose registration a session shares: itself, or the first of the sessions it follows. */
export async function rootOf(env: AdminEnv, sid: string): Promise<string> {
  let cur = sid;
  for (let i = 0; i < 20; i++) {
    const r = await env.DB.prepare("SELECT follows FROM session_registration WHERE session_id = ?").bind(cur).first<{ follows: string | null }>();
    if (!r?.follows || !(await env.DB.prepare("SELECT 1 FROM session_registration WHERE session_id = ?").bind(r.follows).first())) return cur;
    cur = r.follows;
  }
  return cur;
}

export async function loadSettings(env: AdminEnv, sid: string): Promise<RegSettings | null> {
  const r = await env.DB.prepare(
    `SELECT opens_at AS opensAt, deadline, drivers, employees, spectators, factory_reserved AS factoryReserved, independents, team_cap AS teamCap, follows
     FROM session_registration WHERE session_id = ?`,
  )
    .bind(sid)
    .first<SettingsRow>();
  if (!r) return null;
  const root = await rootOf(env, sid);
  if (root !== sid) {
    // A linked session shares the first session's window and numbers; only its independents setting is its own.
    const w = await env.DB.prepare(
      "SELECT opens_at AS opensAt, deadline, drivers, employees, spectators, factory_reserved AS factoryReserved, team_cap AS teamCap FROM session_registration WHERE session_id = ?",
    )
      .bind(root)
      .first<Omit<SettingsRow, "independents" | "follows">>();
    if (w) Object.assign(r, w);
  }
  return { ...r, independents: !!r.independents, follows: root === sid ? null : r.follows };
}

/** The sessions one registration covers, in start order, and the session where it is stored. */
export async function loadGroup(env: AdminEnv, sid: string): Promise<{ root: string; members: (RegGroupMember & { independents: boolean })[] }> {
  const root = await rootOf(env, sid);
  const { results } = await env.DB.prepare(
    `SELECT r.session_id AS id, r.follows, r.independents, s.name, s.starts_at AS startsAt
     FROM session_registration r JOIN sessions s ON s.id = r.session_id
     WHERE s.race_id = (SELECT race_id FROM sessions WHERE id = ?) ORDER BY s.starts_at`,
  )
    .bind(root)
    .all<{ id: string; follows: string | null; independents: number; name: string; startsAt: number }>();
  const ids = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of results) if (r.follows && ids.has(r.follows) && !ids.has(r.id)) (ids.add(r.id), (grew = true));
  }
  const members = results.filter((r) => ids.has(r.id));
  const linked = members.length > 1;
  return { root, members: members.map((m) => ({ id: m.id, name: m.name, teamsOnly: linked && !m.independents, independents: !!m.independents })) };
}

/** Independent drivers can self-register when any session of the group takes them. */
export async function independentsOpen(env: AdminEnv, sid: string): Promise<boolean> {
  return (await loadGroup(env, sid)).members.some((m) => m.independents);
}

const isStaff = (me: Me | null) => hasRole(me, "races", "steward");
const managedTeams = (me: Me | null) => (me?.memberships ?? []).filter((t) => hasAny(t.roles, MANAGER_ROLES));

/** Everyone registered for the group `sid` belongs to, with the cut worked out for `sid` itself. */
export async function loadRegs(env: AdminEnv, sid: string, s: RegSettings): Promise<Registration[]> {
  const group = await loadGroup(env, sid);
  const { results } = await env.DB.prepare(
    `SELECT r.roblox_id AS userId, u.username, r.kind, r.team_id AS teamId, t.name AS teamName, r.discord,
            r.grp AS "group", r.denied, r.created_at AS at
     FROM registrations r JOIN users u ON u.roblox_id = r.roblox_id LEFT JOIN teams t ON t.id = r.team_id
     WHERE r.session_id = ? ORDER BY r.created_at`,
  )
    .bind(group.root)
    .all<Omit<Registration, "denied" | "cut"> & { denied: number }>();
  const factories = new Set(
    (await env.DB.prepare("SELECT id FROM teams WHERE kind = 'factory'").all<{ id: string }>()).results.map((t) => t.id),
  );
  const regs = eligibleFor(results.map((r) => ({ ...r, denied: !!r.denied })), s, group.members.length > 1);
  const cut = computeCut(regs, s, factories);
  return regs.map((r) => ({ ...r, cut: cut.get(r.userId) ?? "waitlist" }));
}

/** Registration of sessions that have not ended, for the home page and My Team. A linked session shows its group's window. */
registration.get("/", async (c) => {
  const now = Date.now();
  const { results } = await c.env.DB.prepare(
    `SELECT r.session_id AS sessionId, r.opens_at AS opensAt, r.deadline, r.independents, r.follows, s.ends_at AS endsAt
     FROM session_registration r JOIN sessions s ON s.id = r.session_id JOIN races a ON a.id = s.race_id
     WHERE a.status = 'active' AND a.expires_at > ?`,
  )
    .bind(now)
    .all<{ sessionId: string; opensAt: number; deadline: number; independents: number; follows: string | null; endsAt: number }>();
  const by = new Map(results.map((r) => [r.sessionId, r]));
  const rootOfRow = (r: (typeof results)[number]) => {
    let cur = r;
    for (let i = 0; i < 20 && cur.follows && by.has(cur.follows); i++) cur = by.get(cur.follows)!;
    return cur;
  };
  const rootFor = new Map(results.map((r) => [r.sessionId, rootOfRow(r)]));
  const groupSize = new Map<string, number>();
  const anyIndependents = new Map<string, boolean>();
  for (const [, root] of rootFor) groupSize.set(root.sessionId, (groupSize.get(root.sessionId) ?? 0) + 1);
  for (const [id, root] of rootFor) if (by.get(id)!.independents) anyIndependents.set(root.sessionId, true);
  return c.json(
    results
      .filter((r) => r.endsAt > now)
      .map((r) => {
        const root = rootFor.get(r.sessionId)!;
        return {
          sessionId: r.sessionId,
          opensAt: root.opensAt,
          deadline: root.deadline,
          independents: anyIndependents.get(root.sessionId) ?? false,
          root: root.sessionId,
          teamsOnly: (groupSize.get(root.sessionId) ?? 1) > 1 && !r.independents,
        };
      }) satisfies RegSummary[],
  );
});

registration.get("/:sid", async (c) => {
  const sid = c.req.param("sid");
  const me = c.get("me");
  const settings = await loadSettings(c.env, sid);
  const empty = { taken: 0, spots: 0 };
  const view: RegistrationView = {
    settings,
    group: [],
    phase: settings ? regPhase(settings, Date.now()) : null,
    counts: { driver: { ...empty }, employee: { ...empty }, spectator: { ...empty } },
    staff: isStaff(me),
    teams: [],
    registrations: [],
    self: null,
  };
  if (!settings) return c.json(view);
  view.group = (await loadGroup(c.env, sid)).members.map(({ id, name, teamsOnly }) => ({ id, name, teamsOnly }));
  const all = await loadRegs(c.env, sid, settings);
  const spots = { driver: settings.drivers, employee: settings.employees, spectator: settings.spectators };
  if (view.staff) for (const k of REG_KINDS) view.counts[k] = { taken: all.filter((r) => r.kind === k && !r.denied).length, spots: spots[k] };
  view.self = all.find((r) => r.userId === me?.id) ?? null;
  const managed = managedTeams(me);
  if (managed.length) {
    const ids = managed.map((t) => t.id);
    const { results } = await c.env.DB.prepare(
      `SELECT m.team_id AS teamId, u.roblox_id AS id, u.username, m.roles FROM team_members m JOIN users u ON u.roblox_id = m.roblox_id
       WHERE m.team_id IN (${ids.map(() => "?").join(",")}) ORDER BY lower(u.username)`,
    )
      .bind(...ids)
      .all<{ teamId: string; id: string; username: string; roles: string }>();
    view.teams = managed.map<RegTeam>((t) => ({
      id: t.id,
      name: t.name,
      members: results.filter((m) => m.teamId === t.id).map((m) => ({ id: m.id, username: m.username, roles: parseRoles(m.roles) })),
    }));
  }
  view.registrations = view.staff
    ? all
    : all.filter((r) => r.userId === me?.id || (r.teamId && managed.some((t) => t.id === r.teamId)));
  return c.json(view);
});

function needMe(c: C): Me | Response {
  const me = c.get("me");
  return me ?? c.json({ error: "unauthorized" }, 401);
}

async function requireOpen(c: C): Promise<RegSettings | Response> {
  const s = await loadSettings(c.env, c.req.param("sid") ?? "");
  if (!s) return c.json({ error: "no_registration" }, 404);
  return regPhase(s, Date.now()) === "open" ? s : c.json({ error: "not_open" }, 409);
}

/** Insert one registration; a person can only be registered once per session. */
async function insertReg(c: C, sid: string, userId: string, kind: RegKind, teamId: string | null, discord: string | null, group: GroupStatus) {
  const existing = await c.env.DB.prepare(
    "SELECT t.name AS team FROM registrations r LEFT JOIN teams t ON t.id = r.team_id WHERE r.session_id = ? AND r.roblox_id = ?",
  )
    .bind(sid, userId)
    .first<{ team: string | null }>();
  if (existing) return c.json({ error: "taken", by: existing.team ?? "an independent registration" }, 409);
  await c.env.DB.prepare(
    "INSERT INTO registrations (session_id, roblox_id, kind, team_id, discord, grp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(sid, userId, kind, teamId, discord, group, Date.now())
    .run();
  return null;
}

const cleanKind = (v: unknown) => (REG_KINDS.includes(v as RegKind) ? (v as RegKind) : null);
const cleanGroup = (v: unknown) => (GROUP_STATUSES.includes(v as GroupStatus) ? (v as GroupStatus) : null);
const cleanDiscord = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_.]{2,32}$/.test(v.trim()) ? v.trim() : null);

// ---- Teams -------------------------------------------------------------------

async function teamManager(c: C) {
  const me = needMe(c);
  if (me instanceof Response) return me;
  const team = managedTeams(me).find((t) => t.id === c.req.param("teamId"));
  return team ?? c.json({ error: "forbidden" }, 403);
}

registration.post("/:sid/team/:teamId", async (c) => {
  const team = await teamManager(c);
  if (team instanceof Response) return team;
  const s = await requireOpen(c);
  if (s instanceof Response) return s;
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; kind?: unknown };
  const kind = cleanKind(body.kind);
  const username = cleanUsername(body.username);
  if (!kind || !username) return c.json({ error: "invalid" }, 400);
  let user: { id: string; username: string } | null;
  if (kind === "spectator") {
    const found = await resolveUser(c, username);
    if (found instanceof Response) return found;
    user = found;
  } else {
    const m = await c.env.DB.prepare(
      "SELECT u.roblox_id AS id, u.username, m.roles FROM team_members m JOIN users u ON u.roblox_id = m.roblox_id WHERE m.team_id = ? AND lower(u.username) = lower(?)",
    )
      .bind(team.id, username)
      .first<{ id: string; username: string; roles: string }>();
    if (!m) return c.json({ error: "not_member" }, 404);
    const roles = parseRoles(m.roles);
    // Drivers need the Driver role; employees are the team's staff.
    if (kind === "driver" ? !roles.includes("driver") : !hasAny(roles, PANEL_ROLES)) return c.json({ error: "wrong_role" }, 400);
    user = m;
  }
  const err = await insertReg(c, await rootOf(c.env, c.req.param("sid")), user.id, kind, team.id, null, "unverified");
  if (!err) await syncRegistered(c.env, c.req.param("sid"));
  return err ?? c.json({ ok: true });
});

registration.delete("/:sid/team/:teamId/:uid", async (c) => {
  const team = await teamManager(c);
  if (team instanceof Response) return team;
  const s = await requireOpen(c);
  if (s instanceof Response) return s;
  await c.env.DB.prepare("DELETE FROM registrations WHERE session_id = ? AND roblox_id = ? AND team_id = ?")
    .bind(await rootOf(c.env, c.req.param("sid")), c.req.param("uid"), team.id)
    .run();
  await syncRegistered(c.env, c.req.param("sid"));
  return c.json({ ok: true });
});

// ---- Independents and the person's own group status ----------------------------

registration.post("/:sid/independent", async (c) => {
  const me = needMe(c);
  if (me instanceof Response) return me;
  const s = await requireOpen(c);
  if (s instanceof Response) return s;
  if (!(await independentsOpen(c.env, c.req.param("sid")))) return c.json({ error: "independents_closed" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { discord?: unknown; group?: unknown };
  const discord = cleanDiscord(body.discord);
  const group = body.group === "joined" || body.group === "pending" ? body.group : null;
  if (!discord) return c.json({ error: "invalid_discord" }, 400);
  if (!group) return c.json({ error: "group_required" }, 400);
  const err = await insertReg(c, await rootOf(c.env, c.req.param("sid")), me.id, "driver", null, discord, group);
  if (!err) await syncRegistered(c.env, c.req.param("sid"));
  return err ?? c.json({ ok: true });
});

/**
 * With access codes on, an independent has no way to sign in yet. They ask by Roblox username; staff check the
 * Discord contact and hand out a code. Needs no sign-in, so it is limited per address.
 */
registration.post("/:sid/independent-request", async (c) => {
  if (!(await tokenMode(c.env.DB))) return c.json({ error: "forbidden" }, 403);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "local";
  if (!(await hit(c.env.DB, `reg:${ip}`, 5))) return c.json({ error: "rate_limited" }, 429);
  const s = await requireOpen(c);
  if (s instanceof Response) return s;
  if (!(await independentsOpen(c.env, c.req.param("sid")))) return c.json({ error: "independents_closed" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; discord?: unknown; group?: unknown };
  const username = cleanUsername(body.username);
  const discord = cleanDiscord(body.discord);
  const group = body.group === "joined" || body.group === "pending" ? body.group : null;
  if (!username) return c.json({ error: "invalid_username" }, 400);
  if (!discord) return c.json({ error: "invalid_discord" }, 400);
  if (!group) return c.json({ error: "group_required" }, 400);
  const user = await resolveUser(c, username);
  if (user instanceof Response) return user;
  const err = await insertReg(c, await rootOf(c.env, c.req.param("sid")), user.id, "driver", null, discord, group);
  return err ?? c.json({ ok: true });
});

registration.delete("/:sid/independent", async (c) => {
  const me = needMe(c);
  if (me instanceof Response) return me;
  const s = await requireOpen(c);
  if (s instanceof Response) return s;
  await c.env.DB.prepare("DELETE FROM registrations WHERE session_id = ? AND roblox_id = ? AND team_id IS NULL")
    .bind(await rootOf(c.env, c.req.param("sid")), me.id)
    .run();
  await syncRegistered(c.env, c.req.param("sid"));
  return c.json({ ok: true });
});

/** A registered driver confirms their own Roblox group status (before the deadline). */
registration.put("/:sid/self/group", async (c) => {
  const me = needMe(c);
  if (me instanceof Response) return me;
  const s = await requireOpen(c);
  if (s instanceof Response) return s;
  const group = cleanGroup(((await c.req.json().catch(() => ({}))) as { group?: unknown }).group);
  if (!group) return c.json({ error: "invalid" }, 400);
  const r = await c.env.DB.prepare("UPDATE registrations SET grp = ? WHERE session_id = ? AND roblox_id = ? AND kind = 'driver'")
    .bind(group, await rootOf(c.env, c.req.param("sid")), me.id)
    .run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

// ---- Staff --------------------------------------------------------------------

async function staff(c: C) {
  const me = needMe(c);
  if (me instanceof Response) return me;
  return hasRole(me, "races", "steward") ? me : c.json({ error: "forbidden" }, 403);
}

const teamOk = async (c: C, teamId: unknown) =>
  teamId === null || (typeof teamId === "string" && !!(await c.env.DB.prepare("SELECT 1 FROM teams WHERE id = ?").bind(teamId).first()));

registration.post("/:sid/staff", async (c) => {
  const me = await staff(c);
  if (me instanceof Response) return me;
  const param = c.req.param("sid");
  if (!(await loadSettings(c.env, param))) return c.json({ error: "no_registration" }, 404);
  const sid = await rootOf(c.env, param);
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; kind?: unknown; teamId?: unknown; discord?: unknown; group?: unknown };
  const kind = cleanKind(body.kind);
  const username = cleanUsername(body.username);
  const teamId = body.teamId ?? null;
  if (!kind || !username || !(await teamOk(c, teamId))) return c.json({ error: "invalid" }, 400);
  const user = await resolveUser(c, username);
  if (user instanceof Response) return user;
  const err = await insertReg(c, sid, user.id, kind, teamId as string | null, cleanDiscord(body.discord), cleanGroup(body.group) ?? "unverified");
  if (!err) await syncRegistered(c.env, param);
  return err ?? c.json({ ok: true });
});

registration.put("/:sid/staff/:uid", async (c) => {
  const me = await staff(c);
  if (me instanceof Response) return me;
  const sid = await rootOf(c.env, c.req.param("sid"));
  const uid = c.req.param("uid");
  const cur = await c.env.DB.prepare("SELECT kind, team_id AS teamId, grp, denied, discord FROM registrations WHERE session_id = ? AND roblox_id = ?")
    .bind(sid, uid)
    .first<{ kind: RegKind; teamId: string | null; grp: GroupStatus; denied: number; discord: string | null }>();
  if (!cur) return c.json({ error: "not_found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { denied?: unknown; teamId?: unknown; group?: unknown; kind?: unknown; discord?: unknown };
  const teamId = body.teamId === undefined ? cur.teamId : (body.teamId as string | null);
  const kind = body.kind === undefined ? cur.kind : cleanKind(body.kind);
  const group = body.group === undefined ? cur.grp : cleanGroup(body.group);
  const discord = body.discord === undefined ? cur.discord : cleanDiscord(body.discord);
  if (!kind || !group || !(await teamOk(c, teamId))) return c.json({ error: "invalid" }, 400);
  const denied = body.denied === undefined ? cur.denied : body.denied ? 1 : 0;
  await c.env.DB.prepare("UPDATE registrations SET kind = ?, team_id = ?, grp = ?, denied = ?, discord = ? WHERE session_id = ? AND roblox_id = ?")
    .bind(kind, teamId, group, denied, discord, sid, uid)
    .run();
  await syncRegistered(c.env, c.req.param("sid"));
  return c.json({ ok: true });
});

/** Staff hand an access code to a registered person who has no team. */
registration.post("/:sid/staff/:uid/code", async (c) => {
  const me = await staff(c);
  if (me instanceof Response) return me;
  if (!(await canIssueFor(c.env.DB, c.req.param("uid"), { registered: await rootOf(c.env, c.req.param("sid")) }))) return c.json({ error: "code_not_allowed" }, 403);
  return c.json(await issueCode(c.env, c.req.param("uid"), me.id));
});

registration.delete("/:sid/staff/:uid", async (c) => {
  const me = await staff(c);
  if (me instanceof Response) return me;
  await c.env.DB.prepare("DELETE FROM registrations WHERE session_id = ? AND roblox_id = ?").bind(await rootOf(c.env, c.req.param("sid")), c.req.param("uid")).run();
  await syncRegistered(c.env, c.req.param("sid"));
  return c.json({ ok: true });
});
