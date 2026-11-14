import type { Me, RaceSummary, SessionSummary } from "../shared/types";
import {
  applyTeamLimit,
  computeCut,
  eligibleFor,
  heldSpots,
  waitPositions,
  REG_KINDS,
  regPhase,
  type Cut,
  type RegGroupMember,
  type RegSettings,
  type RegTeam,
  type Registration,
  type RegistrationView,
  type GroupStatus,
  type RegKind,
  type EventView,
} from "../shared/registration";
import { hasAny, MANAGER_ROLES, parseRoles, type TeamRole } from "../shared/teams";
import { buildMe, ME_ROLES, ME_TEAMS, ME_USER, getMe, type AuthEnv, type MeTeamRow, type MeUser } from "./auth";
import { readSession, SESSION_COOKIE } from "./auth/session";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { hasRole } from "./auth";

/**
 * Everything the registration screens need about one event, read in a single round trip to the database
 * (the signed-in user comes in the same batch), and worked out in memory from there.
 */
export interface SettingsRow {
  sessionId: string;
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
}

export interface RegRow {
  sessionId: string;
  userId: string;
  username: string;
  kind: RegKind;
  teamId: string | null;
  teamName: string | null;
  discord: string | null;
  group: GroupStatus;
  denied: number;
  at: number;
}

export interface MemberRow {
  teamId: string;
  id: string;
  username: string;
  roles: string;
}

export interface EventData {
  me: Me | null;
  race: RaceSummary | null;
  settings: Map<string, SettingsRow>;
  regs: RegRow[];
  picks: { sessionId: string; userId: string }[];
  factories: Set<string>;
  members: MemberRow[];
  /** Every team with its car, only when asked for (staging the queue needs it). */
  teams: Map<string, { id: string; name: string; kind: string; car: string | null; factoryId: string | null }>;
}

type Selector = { raceId: string } | { sessionId: string };

const SESSION_COLS = "id, race_id AS raceId, name, type, starts_at AS startsAt, ends_at AS endsAt, self_timed AS selfTimed, staging";

export async function loadEventData(env: AuthEnv, c: Context | null, by: Selector, withTeams = false): Promise<EventData> {
  const cookie = c ? getCookie(c, SESSION_COOKIE) : undefined;
  const claims = await readSession(env.SESSION_SECRET, cookie);
  // Access-code sessions are checked against the code first (rare); everyone else is loaded in the same batch below.
  const tokenMe = claims?.via === "token" ? await getMe(env, cookie) : null;
  const sub = claims && (claims.via !== "token" || tokenMe) ? claims.sub : null;
  const db = env.DB;
  const rid = "raceId" in by ? "?1" : "(SELECT race_id FROM sessions WHERE id = ?1)";
  const arg = "raceId" in by ? by.raceId : by.sessionId;
  const inRace = `(SELECT id FROM sessions WHERE race_id = ${rid})`;
  const now = Date.now();
  const stmts = [
    db.prepare(`SELECT id, name, expires_at AS expiresAt, (status = 'archived' OR expires_at <= ?2) AS ended FROM races WHERE id = ${rid}`).bind(arg, now),
    db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE race_id = ${rid} ORDER BY starts_at, position`).bind(arg),
    db
      .prepare(
        `SELECT session_id AS sessionId, opens_at AS opensAt, deadline, drivers, employees, spectators, factory_reserved AS factoryReserved, independents, team_cap AS teamCap, team_limit AS teamLimit, pick_cutoff AS pickCutoff, follows
         FROM session_registration WHERE session_id IN ${inRace}`,
      )
      .bind(arg),
    db
      .prepare(
        `SELECT r.session_id AS sessionId, r.roblox_id AS userId, u.username, r.kind, r.team_id AS teamId, t.name AS teamName, r.discord, r.grp AS "group", r.denied, r.created_at AS at
         FROM registrations r JOIN users u ON u.roblox_id = r.roblox_id LEFT JOIN teams t ON t.id = r.team_id
         WHERE r.session_id IN ${inRace} ORDER BY r.created_at`,
      )
      .bind(arg),
    db.prepare(`SELECT session_id AS sessionId, roblox_id AS userId FROM session_picks WHERE session_id IN ${inRace}`).bind(arg),
    db.prepare("SELECT id FROM teams WHERE kind = 'factory'"),
  ];
  if (sub) {
    stmts.push(
      db
        .prepare(
          `SELECT m.team_id AS teamId, u.roblox_id AS id, u.username, m.roles FROM team_members m JOIN users u ON u.roblox_id = m.roblox_id
           WHERE m.team_id IN (SELECT team_id FROM team_members WHERE roblox_id = ?1) ORDER BY lower(u.username)`,
        )
        .bind(sub),
    );
    if (!tokenMe) stmts.push(db.prepare(ME_USER).bind(sub), db.prepare(ME_ROLES).bind(sub), db.prepare(ME_TEAMS).bind(sub));
  }
  if (withTeams) stmts.push(db.prepare("SELECT id, name, kind, car, factory_id AS factoryId FROM teams"));
  const out = await db.batch(stmts);
  const rows = <T>(i: number) => (out[i]?.results ?? []) as T[];
  const raceRow = rows<{ id: string; name: string; expiresAt: number; ended: number }>(0)[0];
  const sessions = rows<Omit<SessionSummary, "selfTimed" | "staging"> & { selfTimed: number; staging: number }>(1).map((r) => ({ ...r, selfTimed: !!r.selfTimed, staging: !!r.staging }));
  const members = sub ? rows<MemberRow>(6) : [];
  const me = !sub
    ? null
    : (tokenMe ?? buildMe(claims!, rows<MeUser>(7)[0] ?? null, rows<{ role: never }>(8), rows<MeTeamRow>(9)));
  return {
    me,
    race: raceRow ? { ...raceRow, ended: !!raceRow.ended, sessions } : null,
    settings: new Map(rows<SettingsRow>(2).map((r) => [r.sessionId, r])),
    regs: rows<RegRow>(3),
    picks: rows<{ sessionId: string; userId: string }>(4),
    factories: new Set(rows<{ id: string }>(5).map((t) => t.id)),
    members,
    teams: new Map(withTeams ? rows<{ id: string; name: string; kind: string; car: string | null; factoryId: string | null }>(out.length - 1).map((t) => [t.id, t]) : []),
  };
}

// ---- Working things out in memory -------------------------------------------------

/** The session whose registration `sid` shares: itself, or the first of the sessions it follows. */
export function rootIn(d: EventData, sid: string): string {
  let cur = sid;
  for (let i = 0; i < 20; i++) {
    const next = d.settings.get(cur)?.follows;
    if (!next || !d.settings.has(next)) return cur;
    cur = next;
  }
  return cur;
}

export function settingsIn(d: EventData, sid: string): RegSettings | null {
  const r = d.settings.get(sid);
  if (!r) return null;
  const root = rootIn(d, sid);
  const w = root === sid ? null : d.settings.get(root);
  // A linked session shares the first session's window and numbers; only its independents setting is its own.
  const shared = w ? { opensAt: w.opensAt, deadline: w.deadline, drivers: w.drivers, employees: w.employees, spectators: w.spectators, factoryReserved: w.factoryReserved, teamCap: w.teamCap } : {};
  return {
    opensAt: r.opensAt,
    deadline: r.deadline,
    drivers: r.drivers,
    employees: r.employees,
    spectators: r.spectators,
    factoryReserved: r.factoryReserved,
    teamCap: r.teamCap,
    teamLimit: r.teamLimit,
    pickCutoff: r.pickCutoff,
    ...shared,
    independents: !!r.independents,
    follows: root === sid ? null : r.follows,
  };
}

export function groupIn(d: EventData, sid: string): { root: string; members: (RegGroupMember & { independents: boolean })[] } {
  const root = rootIn(d, sid);
  const rows = (d.race?.sessions ?? []).filter((s) => d.settings.has(s.id)).map((s) => ({ ...d.settings.get(s.id)!, name: s.name }));
  const ids = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) if (r.follows && ids.has(r.follows) && !ids.has(r.sessionId)) (ids.add(r.sessionId), (grew = true));
  }
  const members = rows.filter((r) => ids.has(r.sessionId));
  const linked = members.length > 1;
  return { root, members: members.map((m) => ({ id: m.sessionId, name: m.name, teamsOnly: linked && !m.independents, independents: !!m.independents })) };
}

/**
 * Everyone registered for the group, with one result each. Linked sessions share one list of spots, so the cut and the
 * waiting list are worked out once for the group, never per session.
 */
export function groupRegs(d: EventData, group: ReturnType<typeof groupIn>): { regs: Registration[]; held: number; settings: RegSettings | null } {
  const gs = settingsIn(d, group.root);
  if (!gs) return { regs: [], held: 0, settings: null };
  const rows = d.regs.filter((r) => r.sessionId === group.root).map(({ sessionId: _s, ...r }) => ({ ...r, denied: !!r.denied }));
  const cut = computeCut(rows, gs, d.factories);
  const withCut = rows.map((r) => ({ ...r, cut: cut.get(r.userId) ?? ("waitlist" as Cut) }));
  const pos = waitPositions(withCut);
  return { regs: withCut.map((r) => ({ ...r, waitPos: pos.get(r.userId) ?? null })), held: heldSpots(rows, gs, d.factories), settings: gs };
}

/** The registrations that take part in one session: the group's results, minus people this session does not take. */
export function regsIn(d: EventData, sid: string, s: RegSettings, group: ReturnType<typeof groupIn>): Registration[] {
  const regs = eligibleFor(groupRegs(d, group).regs, s, group.members.length > 1);
  const picks = new Set(d.picks.filter((p) => p.sessionId === sid).map((p) => p.userId));
  return applyTeamLimit(regs, s.teamLimit, picks);
}

export const isStaff = (me: Me | null) => hasRole(me, "races", "steward");
export const managedTeams = (me: Me | null) => (me?.memberships ?? []).filter((t) => hasAny(t.roles, MANAGER_ROLES));

export function pickUntilIn(d: EventData, sid: string, s: RegSettings): number | null {
  if (s.teamLimit === null) return null;
  return s.pickCutoff ?? d.race?.sessions.find((x) => x.id === sid)?.startsAt ?? null;
}

/** What /api/registration/:sid answers for one session. */
export function viewIn(d: EventData, sid: string, now = Date.now()): RegistrationView {
  const me = d.me;
  const settings = settingsIn(d, sid);
  const empty = { taken: 0, spots: 0, waiting: 0, held: 0 };
  const view: RegistrationView = {
    settings,
    group: [],
    pickUntil: null,
    phase: settings ? regPhase(settings, now) : null,
    counts: { driver: { ...empty }, employee: { ...empty }, spectator: { ...empty } },
    staff: isStaff(me),
    teams: [],
    registrations: [],
    self: null,
  };
  if (!settings) return view;
  const managed = managedTeams(me);
  const group = groupIn(d, sid);
  const all = regsIn(d, sid, settings, group);
  const g = groupRegs(d, group);
  view.pickUntil = pickUntilIn(d, sid, settings);
  view.group = group.members.map(({ id, name, teamsOnly }) => ({ id, name, teamsOnly }));
  const gs = g.settings ?? settings;
  const spots = { driver: gs.drivers, employee: gs.employees, spectator: gs.spectators };
  // Everyone sees the spots, the people who are In and the waiting list, counted over the whole group.
  for (const k of REG_KINDS) {
    view.counts[k] = { spots: spots[k], taken: g.regs.filter((r) => r.kind === k && r.cut === "in").length, waiting: g.regs.filter((r) => r.kind === k && r.cut === "waitlist").length, held: k === "driver" ? g.held : 0 };
  }
  view.self = all.find((r) => r.userId === me?.id) ?? null;
  if (managed.length) {
    view.teams = managed.map<RegTeam>((t) => ({
      id: t.id,
      name: t.name,
      factory: d.factories.has(t.id),
      members: d.members.filter((m) => m.teamId === t.id).map((m) => ({ id: m.id, username: m.username, roles: parseRoles(m.roles) as TeamRole[] })),
    }));
  }
  view.registrations = view.staff ? all : all.filter((r) => r.userId === me?.id || (r.teamId && managed.some((t) => t.id === r.teamId)));
  return view;
}

export function eventIn(d: EventData, now = Date.now()): EventView | null {
  if (!d.race) return null;
  const sessions: EventView["sessions"] = {};
  for (const s of d.race.sessions) if (d.settings.has(s.id)) sessions[s.id] = { root: rootIn(d, s.id), view: viewIn(d, s.id, now) };
  return { race: d.race, sessions };
}
