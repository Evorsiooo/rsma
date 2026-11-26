import type { Me, RaceSummary, SessionSummary } from "../shared/types";
import {
  applyTeamLimit,
  computeCut,
  computeEnduranceCut,
  lineupLockAt,
  lineupOf,
  raceDrivers,
  type Car,
  type EntryInput,
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
import type { AttendanceStatus } from "../shared/attendance";
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
  endurance: number;
  carsPerTeam: number;
  seatsPerCar: number;
  attendance: number;
  attendanceOpens: number;
  attendanceCloses: number;
}

export interface EntryRow {
  id: string;
  rootSession: string;
  teamId: string;
  teamName: string | null;
  label: string;
  number: string | null;
  plate: string | null;
  seats: number;
  at: number;
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

export interface AttendanceRowDb {
  sessionId: string;
  userId: string;
  status: AttendanceStatus;
  at: number;
  by: string;
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
  /** Cars entered in endurance events, and their ranked drivers. */
  entries: EntryRow[];
  lineups: { entryId: string; userId: string; rank: number }[];
  /** Answers given through the attendance link (or set by staff), for every session of the event. */
  attendance: AttendanceRowDb[];
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
    db.prepare(`SELECT id, name, expires_at AS expiresAt, track_id AS trackId, (status = 'archived' OR expires_at <= ?2) AS ended FROM races WHERE id = ${rid}`).bind(arg, now),
    db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE race_id = ${rid} ORDER BY starts_at, position`).bind(arg),
    db
      .prepare(
        `SELECT session_id AS sessionId, opens_at AS opensAt, deadline, drivers, employees, spectators, factory_reserved AS factoryReserved, independents, team_cap AS teamCap, team_limit AS teamLimit, pick_cutoff AS pickCutoff, follows, endurance, cars_per_team AS carsPerTeam, seats_per_car AS seatsPerCar, attendance, attendance_opens AS attendanceOpens, attendance_closes AS attendanceCloses
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
    db.prepare(`SELECT e.id, e.root_session AS rootSession, e.team_id AS teamId, t.name AS teamName, e.label, e.number, e.plate, e.seats, e.created_at AS at FROM entries e LEFT JOIN teams t ON t.id = e.team_id WHERE e.root_session IN ${inRace} ORDER BY e.created_at, e.id`).bind(arg),
    db.prepare(`SELECT entry_id AS entryId, roblox_id AS userId, rank FROM entry_drivers WHERE root_session IN ${inRace} ORDER BY rank`).bind(arg),
    db.prepare(`SELECT session_id AS sessionId, roblox_id AS userId, status, at, by FROM attendance WHERE session_id IN ${inRace}`).bind(arg),
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
  const raceRow = rows<{ id: string; name: string; expiresAt: number; trackId: string | null; ended: number }>(0)[0];
  const sessions = rows<Omit<SessionSummary, "selfTimed" | "staging"> & { selfTimed: number; staging: number }>(1).map((r) => ({ ...r, selfTimed: !!r.selfTimed, staging: !!r.staging }));
  const members = sub ? rows<MemberRow>(9) : [];
  const me = !sub
    ? null
    : (tokenMe ?? buildMe(claims!, rows<MeUser>(10)[0] ?? null, rows<{ role: never }>(11), rows<MeTeamRow>(12)));
  return {
    me,
    race: raceRow ? { ...raceRow, ended: !!raceRow.ended, sessions } : null,
    settings: new Map(rows<SettingsRow>(2).map((r) => [r.sessionId, r])),
    regs: rows<RegRow>(3),
    picks: rows<{ sessionId: string; userId: string }>(4),
    entries: rows<EntryRow>(6),
    lineups: rows<{ entryId: string; userId: string; rank: number }>(7),
    attendance: rows<AttendanceRowDb>(8),
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
  const shared = w ? { opensAt: w.opensAt, deadline: w.deadline, drivers: w.drivers, employees: w.employees, spectators: w.spectators, factoryReserved: w.factoryReserved, teamCap: w.teamCap, endurance: !!w.endurance, carsPerTeam: w.carsPerTeam, seatsPerCar: w.seatsPerCar } : {};
  const out: RegSettings = {
    opensAt: r.opensAt,
    deadline: r.deadline,
    drivers: r.drivers,
    employees: r.employees,
    spectators: r.spectators,
    factoryReserved: r.factoryReserved,
    teamCap: r.teamCap,
    teamLimit: r.teamLimit,
    pickCutoff: r.pickCutoff,
    endurance: !!r.endurance,
    carsPerTeam: r.carsPerTeam,
    seatsPerCar: r.seatsPerCar,
    ...shared,
    independents: !!r.independents,
    follows: root === sid ? null : r.follows,
    // Attendance is each session's own, even when the registration is shared.
    attendance: !!r.attendance,
    attendanceOpens: r.attendanceOpens,
    attendanceCloses: r.attendanceCloses,
  };
  // In an endurance event the lineups replace the per-team driver limit (the stored value is kept, only ignored).
  return out.endurance ? { ...out, teamLimit: null, pickCutoff: null } : out;
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

/** The cars of a group's registration, as the cut sees them: ranked driver ids, only those still really in the car. */
function groupEntries(d: EventData, root: string): { entries: (EntryRow & { drivers: string[] })[]; inputs: EntryInput[] } {
  const entries = d.entries
    .filter((e) => e.rootSession === root)
    .map((e) => ({ ...e, drivers: d.lineups.filter((l) => l.entryId === e.id).sort((a, b) => a.rank - b.rank).map((l) => l.userId) }));
  return { entries, inputs: entries.map((e) => ({ id: e.id, teamId: e.teamId, at: e.at, drivers: e.drivers })) };
}

/**
 * Everyone registered for the group, with one result each. Linked sessions share one list of spots, so the cut and the
 * waiting list are worked out once for the group, never per session. In an endurance event the spots count cars.
 */
export function groupRegs(d: EventData, group: ReturnType<typeof groupIn>): { regs: Registration[]; held: number; settings: RegSettings | null; cars: Car[] } {
  const gs = settingsIn(d, group.root);
  if (!gs) return { regs: [], held: 0, settings: null, cars: [] };
  const rows = d.regs.filter((r) => r.sessionId === group.root).map(({ sessionId: _s, ...r }) => ({ ...r, denied: !!r.denied }));
  if (gs.endurance) return enduranceRegs(d, group.root, rows, gs);
  const cut = computeCut(rows, gs, d.factories);
  const withCut = rows.map((r) => ({ ...r, cut: cut.get(r.userId) ?? ("waitlist" as Cut) }));
  const pos = waitPositions(withCut);
  return { regs: withCut.map((r) => ({ ...r, waitPos: pos.get(r.userId) ?? null, carId: null, rank: null })), held: heldSpots(rows, gs, d.factories), settings: gs, cars: [] };
}

function enduranceRegs(d: EventData, root: string, rows: (Omit<RegRow, "sessionId" | "denied"> & { denied: boolean })[], gs: RegSettings) {
  const { entries, inputs } = groupEntries(d, root);
  const r = computeEnduranceCut(rows, inputs, gs, d.factories);
  const lineups = lineupOf(inputs, rows);
  const where = new Map<string, { carId: string; rank: number }>();
  for (const [carId, list] of lineups) list.forEach((userId, i) => where.set(userId, { carId, rank: i + 1 }));
  const withCut = rows.map((x) => ({ ...x, cut: r.cut.get(x.userId) ?? ("waitlist" as Cut) }));
  // People who are not drivers keep the usual waiting list; drivers wait per car.
  const pos = waitPositions(withCut.filter((x) => x.kind !== "driver"));
  const regs = withCut.map((x) => ({ ...x, waitPos: x.kind === "driver" ? (r.driverWait.get(x.userId) ?? null) : (pos.get(x.userId) ?? null), carId: where.get(x.userId)?.carId ?? null, rank: where.get(x.userId)?.rank ?? null }));
  const name = new Map(rows.map((x) => [x.userId, x.username]));
  const cars = entries.map<Car>((e) => {
    const list = lineups.get(e.id) ?? [];
    return {
      id: e.id,
      teamId: e.teamId,
      teamName: e.teamName ?? "",
      label: e.label,
      number: e.number,
      plate: e.plate,
      seats: e.seats,
      at: e.at,
      cut: r.carCut.get(e.id) ?? "waitlist",
      waitPos: r.carWait.get(e.id) ?? null,
      drivers: list.map((userId, i) => ({ userId, username: name.get(userId) ?? userId, rank: i + 1, race: raceDrivers(list, e.seats).includes(userId) })),
    };
  });
  return { regs, held: r.held, settings: gs, cars };
}

/** The registrations that take part in one session: the group's results, minus people this session does not take. */
export function regsIn(d: EventData, sid: string, s: RegSettings, group: ReturnType<typeof groupIn>): Registration[] {
  const regs = eligibleFor(groupRegs(d, group).regs, s, group.members.length > 1);
  // The lineups of an endurance event replace the per-team driver limit.
  if (s.endurance) return regs;
  const picks = new Set(d.picks.filter((p) => p.sessionId === sid).map((p) => p.userId));
  return applyTeamLimit(regs, s.teamLimit, picks);
}

/**
 * The drivers who may confirm attendance for one session, and who are staged when attendance is off: the registered
 * drivers who are In for it. One place, so changes to who takes part (such as cars with ranked drivers) reach both.
 */
export function driversIn(d: EventData, sid: string): Registration[] {
  const s = settingsIn(d, sid);
  return s ? regsIn(d, sid, s, groupIn(d, sid)).filter((r) => r.kind === "driver" && r.cut === "in") : [];
}

/** What each driver answered for one session. */
export function attendanceOf(d: EventData, sid: string): Map<string, AttendanceStatus> {
  return new Map(d.attendance.filter((a) => a.sessionId === sid).map((a) => [a.userId, a.status]));
}

export const isStaff = (me: Me | null) => hasRole(me, "races", "steward");
export const managedTeams = (me: Me | null) => (me?.memberships ?? []).filter((t) => hasAny(t.roles, MANAGER_ROLES));

export function pickUntilIn(d: EventData, sid: string, s: RegSettings): number | null {
  if (s.teamLimit === null) return null;
  return s.pickCutoff ?? d.race?.sessions.find((x) => x.id === sid)?.startsAt ?? null;
}

/** Until when team managers change their lineups: the group's first session's pick cutoff, or its start. Null outside endurance. */
export function lineupLockIn(d: EventData, sid: string): number | null {
  const root = rootIn(d, sid);
  const row = d.settings.get(root);
  if (!row?.endurance) return null;
  return lineupLockAt(row.pickCutoff, d.race?.sessions.find((x) => x.id === root)?.startsAt ?? null);
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
    cars: [],
    lineupLock: null,
    self: null,
  };
  if (!settings) return view;
  const managed = managedTeams(me);
  const group = groupIn(d, sid);
  const all = regsIn(d, sid, settings, group);
  const g = groupRegs(d, group);
  view.pickUntil = pickUntilIn(d, sid, settings);
  view.group = group.members.map(({ id, name, teamsOnly }) => ({ id, name, teamsOnly }));
  view.cars = view.staff ? g.cars : g.cars.filter((c) => managed.some((t) => t.id === c.teamId));
  view.lineupLock = lineupLockIn(d, sid);
  const gs = g.settings ?? settings;
  const spots = { driver: gs.drivers, employee: gs.employees, spectator: gs.spectators };
  // Everyone sees the spots, the people who are In and the waiting list, counted over the whole group.
  for (const k of REG_KINDS) {
    view.counts[k] = { spots: spots[k], taken: g.regs.filter((r) => r.kind === k && r.cut === "in").length, waiting: g.regs.filter((r) => r.kind === k && r.cut === "waitlist").length, held: k === "driver" ? g.held : 0 };
  }
  if (gs.endurance) {
    // Driver spots are cars: each car with a driver counts once, and so does each independent.
    const fielded = g.cars.filter((c) => c.drivers.length > 0);
    const solo = g.regs.filter((r) => r.kind === "driver" && !r.teamId);
    view.counts.driver = {
      ...view.counts.driver,
      taken: fielded.filter((c) => c.cut === "in").length + solo.filter((r) => r.cut === "in").length,
      waiting: fielded.filter((c) => c.cut === "waitlist").length + solo.filter((r) => r.cut === "waitlist").length,
    };
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
