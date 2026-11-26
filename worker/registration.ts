import { canIssueFor, hit, issueCode, tokenMode } from "./access-codes";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Me } from "../shared/types";
import {
  applyTeamLimit,
  computeCut,
  eligibleFor,
  type Cut,
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
import { pruneStatements } from "./entries";
import { syncRegistered } from "./stage";
import { cleanUsername, resolveUser, type AdminEnv } from "./admin";
import { eventIn, loadEventData, lineupLockIn, managedTeams, pickUntilIn, rootIn, settingsIn, viewIn, type EntryRow, type EventData } from "./reg-data";

type E = { Bindings: AdminEnv; Variables: { me: Me | null } };
type C = Context<E>;

export const registration = new Hono<E>();

// These routes read the signed-in user in the same database batch as their data (see reg-data.ts); the list needs no user.
const loadsOwnUser = (c: C) => c.req.path === "/api/registration" || /\/team\/|\/event\/|^\/api\/registration\/[^/]+$/.test(c.req.path);
registration.use("*", async (c, next) => {
  if (!loadsOwnUser(c)) c.set("me", await getMe(c.env, getCookie(c, SESSION_COOKIE)));
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
  teamLimit: number | null;
  pickCutoff: number | null;
  follows: string | null;
  endurance: number;
  carsPerTeam: number;
  seatsPerCar: number;
}

/** The session whose registration a session shares: itself, or the first of the sessions it follows. */
export async function rootOf(env: AdminEnv, sid: string): Promise<string> {
  // The links of the whole race in one query; the chain is followed in memory.
  const { results } = await env.DB.prepare(
    `SELECT session_id AS id, follows FROM session_registration
     WHERE session_id IN (SELECT id FROM sessions WHERE race_id = (SELECT race_id FROM sessions WHERE id = ?1)) OR session_id = ?1`,
  )
    .bind(sid)
    .all<{ id: string; follows: string | null }>();
  const by = new Map(results.map((r) => [r.id, r.follows]));
  let cur = sid;
  for (let i = 0; i < 20; i++) {
    const next = by.get(cur);
    if (!next || !by.has(next)) return cur;
    cur = next;
  }
  return cur;
}

export async function loadSettings(env: AdminEnv, sid: string): Promise<RegSettings | null> {
  const [r, root] = await Promise.all([
    env.DB.prepare(
      `SELECT opens_at AS opensAt, deadline, drivers, employees, spectators, factory_reserved AS factoryReserved, independents, team_cap AS teamCap, team_limit AS teamLimit, pick_cutoff AS pickCutoff, follows, endurance, cars_per_team AS carsPerTeam, seats_per_car AS seatsPerCar
       FROM session_registration WHERE session_id = ?`,
    )
      .bind(sid)
      .first<SettingsRow>(),
    rootOf(env, sid),
  ]);
  if (!r) return null;
  if (root !== sid) {
    // A linked session shares the first session's window and numbers; only its independents setting is its own.
    const w = await env.DB.prepare(
      "SELECT opens_at AS opensAt, deadline, drivers, employees, spectators, factory_reserved AS factoryReserved, team_cap AS teamCap, endurance, cars_per_team AS carsPerTeam, seats_per_car AS seatsPerCar FROM session_registration WHERE session_id = ?",
    )
      .bind(root)
      .first<Omit<SettingsRow, "independents" | "follows" | "teamLimit" | "pickCutoff">>();
    if (w) Object.assign(r, w);
  }
  const out = { ...r, independents: !!r.independents, endurance: !!r.endurance, follows: root === sid ? null : r.follows };
  return out.endurance ? { ...out, teamLimit: null, pickCutoff: null } : out;
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


/** Teams choose their drivers for a session until this time: the cutoff, or the session start. */
async function pickUntil(env: AdminEnv, sid: string, s: RegSettings): Promise<number | null> {
  if (s.teamLimit === null) return null;
  return s.pickCutoff ?? (await env.DB.prepare("SELECT starts_at AS t FROM sessions WHERE id = ?").bind(sid).first<{ t: number }>())?.t ?? null;
}

/** Registration of sessions that have not ended, for the home page and My Team. A linked session shows its group's window. */
registration.get("/", async (c) => {
  const now = Date.now();
  const { results } = await c.env.DB.prepare(
    `SELECT r.session_id AS sessionId, r.opens_at AS opensAt, r.deadline, r.independents, r.follows, r.team_limit AS teamLimit, r.pick_cutoff AS pickCutoff, r.endurance, s.starts_at AS startsAt, s.ends_at AS endsAt
     FROM session_registration r JOIN sessions s ON s.id = r.session_id JOIN races a ON a.id = s.race_id
     WHERE a.status = 'active' AND a.expires_at > ?`,
  )
    .bind(now)
    .all<{ sessionId: string; opensAt: number; deadline: number; independents: number; follows: string | null; teamLimit: number | null; pickCutoff: number | null; endurance: number; startsAt: number; endsAt: number }>();
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
          // The lineups of an endurance event replace the per-team driver limit.
          teamLimit: root.endurance ? null : r.teamLimit,
          pickUntil: r.teamLimit === null || root.endurance ? null : (r.pickCutoff ?? r.startsAt),
        };
      }) satisfies RegSummary[],
  );
});

/** One session's registration, as the staff and driver pages read it. */
registration.get("/:sid", async (c) => {
  const sid = c.req.param("sid");
  return c.json(viewIn(await loadEventData(c.env, c, { sessionId: sid }), sid));
});

/** Everything the event registration page shows, in one request. */
registration.get("/event/:raceId", async (c) => {
  const ev = eventIn(await loadEventData(c.env, c, { raceId: c.req.param("raceId") }));
  return ev ? c.json(ev) : c.json({ error: "not_found" }, 404);
});

/** Staging the queue is not needed for the answer: answer now, finish it right after. */
function syncLater(c: C, sid: string) {
  c.executionCtx.waitUntil(syncRegistered(c.env, sid).catch((e) => console.error("syncRegistered failed", e)));
}

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

/**
 * The routes below answer with the whole event as it is after the change, so the page needs no second request.
 * Adding someone who is already registered by this team, or removing someone who is not, is fine: the answer is the same.
 */
const done = (c: C, d: EventData, extra: object = {}) => c.json({ ok: true, ...extra, event: eventIn(d) });

type Gate = { d: EventData; team: { id: string; name: string }; sid: string } | Response;

/** Loads the event and checks the caller manages the team, in one round trip. */
async function teamGate(c: C): Promise<Gate> {
  const sid = c.req.param("sid") ?? "";
  const d = await loadEventData(c.env, c, { sessionId: sid });
  if (!d.me) return c.json({ error: "unauthorized" }, 401);
  const team = managedTeams(d.me).find((t) => t.id === c.req.param("teamId"));
  return team ? { d, team, sid } : c.json({ error: "forbidden" }, 403);
}

function openSettings(c: C, d: EventData, sid: string): RegSettings | Response {
  const s = settingsIn(d, sid);
  if (!s) return c.json({ error: "no_registration" }, 404);
  return regPhase(s, Date.now()) === "open" ? s : c.json({ error: "not_open" }, 409);
}

registration.post("/:sid/team/:teamId", async (c) => {
  const gate = await teamGate(c);
  if (gate instanceof Response) return gate;
  const { d, team, sid } = gate;
  const s = openSettings(c, d, sid);
  if (s instanceof Response) return s;
  const body = (await c.req.json().catch(() => ({}))) as { username?: unknown; kind?: unknown };
  const kind = cleanKind(body.kind);
  const username = cleanUsername(body.username);
  if (!kind || !username) return c.json({ error: "invalid" }, 400);
  let user: { id: string; username: string };
  if (kind === "spectator") {
    const found = await resolveUser(c, username);
    if (found instanceof Response) return found;
    user = found;
  } else {
    const m = d.members.find((x) => x.teamId === team.id && x.username.toLowerCase() === username.toLowerCase());
    if (!m) return c.json({ error: "not_member" }, 404);
    const roles = parseRoles(m.roles);
    // Drivers need the Driver role; employees are the team's staff.
    if (kind === "driver" ? !roles.includes("driver") : !hasAny(roles, PANEL_ROLES)) return c.json({ error: "wrong_role" }, 400);
    user = m;
  }
  const root = rootIn(d, sid);
  const existing = d.regs.find((r) => r.sessionId === root && r.userId === user.id);
  if (existing) {
    if (existing.teamId === team.id && existing.kind === kind) return done(c, d);
    return c.json({ error: "taken", by: existing.teamName ?? "an independent registration" }, 409);
  }
  const at = Date.now();
  const r = await c.env.DB.prepare(
    "INSERT INTO registrations (session_id, roblox_id, kind, team_id, discord, grp, created_at) VALUES (?, ?, ?, ?, NULL, 'unverified', ?) ON CONFLICT DO NOTHING",
  )
    .bind(root, user.id, kind, team.id, at)
    .run();
  if (!r.meta.changes) return c.json({ error: "taken", by: "someone else a moment ago" }, 409);
  d.regs.push({ sessionId: root, userId: user.id, username: user.username, kind, teamId: team.id, teamName: team.name, discord: null, group: "unverified", denied: 0, at });
  d.regs.sort((a, b) => a.at - b.at);
  syncLater(c, sid);
  return done(c, d);
});

registration.delete("/:sid/team/:teamId/:uid", async (c) => {
  const gate = await teamGate(c);
  if (gate instanceof Response) return gate;
  const { d, team, sid } = gate;
  const s = openSettings(c, d, sid);
  if (s instanceof Response) return s;
  const root = rootIn(d, sid);
  const uid = c.req.param("uid");
  const held = d.regs.some((r) => r.sessionId === root && r.userId === uid && r.teamId === team.id);
  if (!held) return done(c, d);
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM registrations WHERE session_id = ? AND roblox_id = ? AND team_id = ?").bind(root, uid, team.id), ...pruneStatements(c.env.DB)]);
  d.regs = d.regs.filter((r) => !(r.sessionId === root && r.userId === uid && r.teamId === team.id));
  syncLater(c, sid);
  return done(c, d);
});

/** A team manager chooses which of the team's registered drivers take part in this session, until the cutoff. */
registration.put("/:sid/team/:teamId/picks", async (c) => {
  const gate = await teamGate(c);
  if (gate instanceof Response) return gate;
  const { d, team, sid } = gate;
  const s = settingsIn(d, sid);
  if (!s) return c.json({ error: "no_registration" }, 404);
  const until = pickUntilIn(d, sid, s);
  if (s.teamLimit === null || until === null) return c.json({ error: "no_limit" }, 409);
  if (Date.now() > until) return c.json({ error: "picks_closed" }, 409);
  const body = (await c.req.json().catch(() => ({}))) as { userIds?: unknown };
  const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds.filter((v): v is string => typeof v === "string"))] : null;
  if (!ids || ids.length > s.teamLimit) return c.json({ error: "too_many" }, 400);
  const root = rootIn(d, sid);
  const mine = d.regs.filter((r) => r.sessionId === root && r.teamId === team.id && r.kind === "driver" && !r.denied).map((r) => r.userId);
  if (ids.some((id) => !mine.includes(id))) return c.json({ error: "not_registered" }, 400);
  await c.env.DB.batch([
    ...(mine.length ? [c.env.DB.prepare(`DELETE FROM session_picks WHERE session_id = ? AND roblox_id IN (${mine.map(() => "?").join(",")})`).bind(sid, ...mine)] : []),
    ...ids.map((id) => c.env.DB.prepare("INSERT INTO session_picks (session_id, roblox_id) VALUES (?, ?)").bind(sid, id)),
  ]);
  d.picks = [...d.picks.filter((p) => !(p.sessionId === sid && mine.includes(p.userId))), ...ids.map((userId) => ({ sessionId: sid, userId }))];
  syncLater(c, sid);
  return done(c, d);
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
  if (!err) syncLater(c, c.req.param("sid"));
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
  syncLater(c, c.req.param("sid"));
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
  if (!err) syncLater(c, param);
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
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE registrations SET kind = ?, team_id = ?, grp = ?, denied = ?, discord = ? WHERE session_id = ? AND roblox_id = ?").bind(kind, teamId, group, denied, discord, sid, uid),
    ...pruneStatements(c.env.DB),
  ]);
  syncLater(c, c.req.param("sid"));
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
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM registrations WHERE session_id = ? AND roblox_id = ?").bind(await rootOf(c.env, c.req.param("sid")), c.req.param("uid")), ...pruneStatements(c.env.DB)]);
  syncLater(c, c.req.param("sid"));
  return c.json({ ok: true });
});

// ---- Cars (endurance events) ------------------------------------------------------

/** What a staff member sends for a car: the fields are optional, the lineup is the whole ranked list of user ids. */
interface CarBody {
  teamId?: unknown;
  label?: unknown;
  number?: unknown;
  plate?: unknown;
  seats?: unknown;
  drivers?: unknown;
}

const MAX_LINEUP = 30;
const cleanText = (v: unknown, max: number, pattern: RegExp): string | null | undefined =>
  v === undefined ? undefined : v === null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" && v.trim().length <= max && pattern.test(v.trim()) ? v.trim() : undefined;

/** Checks a ranked lineup against the team's registered drivers and the other cars; the error code, or the cleaned ids. */
function checkLineup(d: EventData, root: string, teamId: string, entryId: string | null, v: unknown): string[] | string {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return "invalid";
  const ids = [...new Set(v as string[])];
  if (ids.length > MAX_LINEUP) return "too_many";
  const mine = new Set(d.regs.filter((r) => r.sessionId === root && r.teamId === teamId && r.kind === "driver" && !r.denied).map((r) => r.userId));
  if (ids.some((u) => !mine.has(u))) return "not_registered";
  const taken = new Set(d.lineups.filter((l) => l.entryId !== entryId).map((l) => l.userId));
  if (ids.some((u) => taken.has(u))) return "in_other_car";
  return ids;
}

async function carGate(c: C): Promise<{ me: Me; d: EventData; root: string; s: RegSettings } | Response> {
  const me = await staff(c);
  if (me instanceof Response) return me;
  const sid = c.req.param("sid") ?? "";
  const d = await loadEventData(c.env, c, { sessionId: sid });
  const s = settingsIn(d, sid);
  if (!s) return c.json({ error: "no_registration" }, 404);
  if (!s.endurance) return c.json({ error: "not_endurance" }, 409);
  return { me, d, root: rootIn(d, sid), s };
}

const lineupStatements = (c: C, root: string, entryId: string, ids: string[]) => [
  c.env.DB.prepare("DELETE FROM entry_drivers WHERE entry_id = ?").bind(entryId),
  ...ids.map((u, i) => c.env.DB.prepare("INSERT INTO entry_drivers (entry_id, root_session, roblox_id, rank) VALUES (?, ?, ?, ?)").bind(entryId, root, u, i + 1)),
];

/** The event as it is after a change to the cars; staging follows in the background, like a registration change. */
async function carsDone(c: C) {
  const sid = c.req.param("sid") ?? "";
  syncLater(c, sid);
  return done(c, await loadEventData(c.env, c, { sessionId: sid }));
}

/** Enters a car for a team, up to the event's cars per team. Used by staff and by the team's managers. */
async function addCar(c: C, d: EventData, root: string, s: RegSettings, teamId: string, b: CarBody) {
  const own = d.entries.filter((e) => e.rootSession === root && e.teamId === teamId);
  if (own.length >= s.carsPerTeam) return c.json({ error: "car_limit" }, 409);
  const label = cleanText(b.label, 40, /^[^\n]+$/) ?? `Car ${own.length + 1}`;
  const number = b.number === undefined ? null : cleanText(b.number, 4, /^[A-Za-z0-9]+$/);
  const plate = b.plate === undefined ? null : cleanText(b.plate, 12, /^[A-Za-z0-9 -]+$/);
  const seats = b.seats === undefined ? s.seatsPerCar : b.seats;
  if (number === undefined || plate === undefined || !Number.isInteger(seats) || (seats as number) < 1 || (seats as number) > s.seatsPerCar) return c.json({ error: "invalid" }, 400);
  if (number && d.entries.some((e) => e.rootSession === root && e.number === number)) return c.json({ error: "number_taken" }, 409);
  const ids = b.drivers === undefined ? [] : checkLineup(d, root, teamId, null, b.drivers);
  if (typeof ids === "string") return c.json({ error: ids }, ids === "in_other_car" ? 409 : 400);
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO entries (id, root_session, team_id, label, number, plate, seats, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, root, teamId, label, number, plate, seats, Date.now()),
    ...lineupStatements(c, root, id, ids).slice(1),
  ]);
  return carsDone(c);
}

/** Changes a car's label, number, plate, race seats or its whole ranked lineup. */
async function editCar(c: C, d: EventData, root: string, s: RegSettings, cur: EntryRow, b: CarBody) {
  const label = cleanText(b.label, 40, /^[^\n]+$/);
  const number = cleanText(b.number, 4, /^[A-Za-z0-9]+$/);
  const plate = cleanText(b.plate, 12, /^[A-Za-z0-9 -]+$/);
  const seats = b.seats === undefined ? cur.seats : b.seats;
  if (label === null || number === undefined && b.number !== undefined || plate === undefined && b.plate !== undefined || !Number.isInteger(seats) || (seats as number) < 1 || (seats as number) > Math.max(s.seatsPerCar, cur.seats)) return c.json({ error: "invalid" }, 400);
  if (number && d.entries.some((e) => e.rootSession === root && e.id !== cur.id && e.number === number)) return c.json({ error: "number_taken" }, 409);
  const ids = b.drivers === undefined ? null : checkLineup(d, root, cur.teamId, cur.id, b.drivers);
  if (typeof ids === "string") return c.json({ error: ids }, ids === "in_other_car" ? 409 : 400);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE entries SET label = ?, number = ?, plate = ?, seats = ? WHERE id = ?").bind(label ?? cur.label, b.number === undefined ? cur.number : number, b.plate === undefined ? cur.plate : plate, seats, cur.id),
    ...(ids ? lineupStatements(c, root, cur.id, ids) : []),
  ]);
  return carsDone(c);
}

const removeCar = async (c: C, root: string, id: string) => {
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM entry_drivers WHERE entry_id = ?").bind(id), c.env.DB.prepare("DELETE FROM entries WHERE id = ? AND root_session = ?").bind(id, root)]);
  return carsDone(c);
};

/** Staff enter a car for a team. Staff can change cars at any time, also after the lineups lock. */
registration.post("/:sid/cars", async (c) => {
  const gate = await carGate(c);
  if (gate instanceof Response) return gate;
  const b = (await c.req.json().catch(() => ({}))) as CarBody;
  if (typeof b.teamId !== "string" || !(await teamOk(c, b.teamId))) return c.json({ error: "invalid" }, 400);
  return addCar(c, gate.d, gate.root, gate.s, b.teamId, b);
});

registration.put("/:sid/cars/:id", async (c) => {
  const gate = await carGate(c);
  if (gate instanceof Response) return gate;
  const cur = gate.d.entries.find((e) => e.id === c.req.param("id") && e.rootSession === gate.root);
  if (!cur) return c.json({ error: "not_found" }, 404);
  return editCar(c, gate.d, gate.root, gate.s, cur, (await c.req.json().catch(() => ({}))) as CarBody);
});

registration.delete("/:sid/cars/:id", async (c) => {
  const gate = await carGate(c);
  if (gate instanceof Response) return gate;
  return removeCar(c, gate.root, c.req.param("id"));
});

/** Loads the event and checks the caller manages the team, the event is an endurance event and the lineups are not locked. */
async function lineupGate(c: C): Promise<{ d: EventData; team: { id: string; name: string }; root: string; s: RegSettings } | Response> {
  const gate = await teamGate(c);
  if (gate instanceof Response) return gate;
  const { d, team, sid } = gate;
  const s = settingsIn(d, sid);
  if (!s) return c.json({ error: "no_registration" }, 404);
  if (!s.endurance) return c.json({ error: "not_endurance" }, 409);
  const lock = lineupLockIn(d, sid);
  if (lock !== null && Date.now() > lock) return c.json({ error: "lineup_locked" }, 409);
  return { d, team, root: rootIn(d, sid), s };
}

/** A team's managers enter a car and rank its drivers until the lineups lock; after that only staff change them. */
registration.post("/:sid/team/:teamId/cars", async (c) => {
  const g = await lineupGate(c);
  if (g instanceof Response) return g;
  return addCar(c, g.d, g.root, g.s, g.team.id, (await c.req.json().catch(() => ({}))) as CarBody);
});

registration.put("/:sid/team/:teamId/cars/:id", async (c) => {
  const g = await lineupGate(c);
  if (g instanceof Response) return g;
  const cur = g.d.entries.find((e) => e.id === c.req.param("id") && e.rootSession === g.root && e.teamId === g.team.id);
  if (!cur) return c.json({ error: "not_found" }, 404);
  return editCar(c, g.d, g.root, g.s, cur, (await c.req.json().catch(() => ({}))) as CarBody);
});

registration.delete("/:sid/team/:teamId/cars/:id", async (c) => {
  const g = await lineupGate(c);
  if (g instanceof Response) return g;
  const cur = g.d.entries.find((e) => e.id === c.req.param("id") && e.rootSession === g.root && e.teamId === g.team.id);
  if (!cur) return carsDone(c);
  return removeCar(c, g.root, cur.id);
});
