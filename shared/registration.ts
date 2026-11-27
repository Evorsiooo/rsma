export type RegKind = "driver" | "employee" | "spectator";
export const REG_KINDS: RegKind[] = ["driver", "employee", "spectator"];
export const REG_KIND_LABEL: Record<RegKind, string> = { driver: "Driver", employee: "Employee", spectator: "Spectator" };

/** Roblox group membership: joined, join request pending, or not yet confirmed. */
export type GroupStatus = "joined" | "pending" | "unverified";
export const GROUP_STATUSES: GroupStatus[] = ["joined", "pending", "unverified"];
/** Staff only care that the person joined or has a request pending. */
export const inGroup = (g: GroupStatus) => g !== "unverified";
export const GROUP_URL = "https://www.roblox.com/communities/33125027/Ro-State-Motorsport-Association#!/about";

export interface RegSettings {
  opensAt: number;
  deadline: number;
  drivers: number;
  employees: number;
  spectators: number;
  /** Driver slots held for each factory team. */
  factoryReserved: number;
  independents: boolean;
  /** Most driver spots all teams together can take; null for no cap. */
  teamCap: number | null;
  /** Most drivers each team fields in this session, chosen by the team; null for no limit. Not shared with the group. */
  teamLimit: number | null;
  /** Until when teams can change who they field; null for the session start. */
  pickCutoff: number | null;
  /** Session whose registration this one shares (the window is that session's); null when it has its own. */
  follows: string | null;
  /** Endurance event: teams enter cars with ranked drivers, and the driver spots count cars. Shared with the group. */
  endurance: boolean;
  /** Most cars one team can enter (endurance only). Shared with the group. */
  carsPerTeam: number;
  /** Most drivers that race in one car; the rest of the lineup is reserve (endurance only). Shared with the group. */
  seatsPerCar: number;
  /** Drivers confirm attendance through a link before the session; only those present are staged. Per session, not shared by a link. */
  attendance: boolean;
  /** Minutes before the session starts that the attendance link opens. */
  attendanceOpens: number;
  /** Minutes after the session starts that attendance closes. */
  attendanceCloses: number;
}

export interface RegSummary {
  sessionId: string;
  opensAt: number;
  deadline: number;
  /** Independent drivers can register for this session or one linked to it. */
  independents: boolean;
  /** The first session of the group: where registrations are stored. Equals sessionId when not linked. */
  root: string;
  /** This session does not take independent drivers, even though the group registration does. */
  teamsOnly: boolean;
  /** Most drivers each team fields in this session; null for no limit. */
  teamLimit: number | null;
  /** Teams choose their drivers until this time; null with no limit. */
  pickUntil: number | null;
}

/** One registration covers every session in a group; each session keeps its own spots and eligibility. */
export interface RegGroupMember {
  id: string;
  name: string;
  teamsOnly: boolean;
}

export interface SpotCount {
  spots: number;
  taken: number;
  waiting: number;
  /** Driver spots kept free for factory teams that have not filled their reserved spots yet. */
  held: number;
}

export type RegPhase = "upcoming" | "open" | "closed";
export const regPhase = (s: Pick<RegSettings, "opensAt" | "deadline">, now: number): RegPhase =>
  now < s.opensAt ? "upcoming" : now <= s.deadline ? "open" : "closed";

/** "out": registered with the group but not fielded by their team in this session. */
export type Cut = "in" | "waitlist" | "denied" | "out";

export const CUT_LABEL: Record<Cut, string> = { in: "In", waitlist: "Waiting", denied: "Denied", out: "Not in this session" };

export interface Registration {
  userId: string;
  username: string;
  kind: RegKind;
  /** null: independent driver. */
  teamId: string | null;
  teamName: string | null;
  discord: string | null;
  group: GroupStatus;
  denied: boolean;
  at: number;
  cut: Cut;
  /** Place on the waiting list, 1 is next to move up. Only for people who are Waiting. In an endurance event a car's drivers share the car's place. */
  waitPos: number | null;
  /** Endurance: the car the driver is in and their rank in it (1 is first); null when not in a car. */
  carId: string | null;
  rank: number | null;
}

/** A car a team enters in an endurance event, with its ranked drivers. */
export interface Car {
  id: string;
  teamId: string;
  teamName: string;
  label: string;
  number: string | null;
  plate: string | null;
  /** How many of its drivers race; the rest are reserve. */
  seats: number;
  at: number;
  /** "in" or "waitlist"; a car without a registered driver is Waiting. */
  cut: "in" | "waitlist";
  waitPos: number | null;
  /** In rank order. */
  drivers: { userId: string; username: string; rank: number; race: boolean }[];
}

export interface RegTeam {
  id: string;
  name: string;
  /** Factory teams have reserved driver spots. */
  factory: boolean;
  members: { id: string; username: string; roles: import("./teams").TeamRole[] }[];
}

export interface RegistrationView {
  settings: RegSettings | null;
  /** Until when teams can choose who they field, when this session has a team limit. */
  pickUntil: number | null;
  /** Sessions this registration covers, in start order; one entry when the session is not linked. */
  group: RegGroupMember[];
  phase: RegPhase | null;
  /** Per kind, for the whole registration group: spots, people who are In, people who are Waiting, and spots held back for factory teams. */
  counts: Record<RegKind, SpotCount>;
  staff: boolean;
  /** Teams the viewer registers for. */
  teams: RegTeam[];
  /** Staff see everyone, team managers their teams, an independent their own. */
  registrations: Registration[];
  /** Endurance events only: the cars entered, for staff all of them, for team managers their teams' cars. */
  cars: Car[];
  /** Endurance events only: until when team managers can change their lineups. Staff can change them after. */
  lineupLock: number | null;
  /** The viewer's own registration, if any. */
  self: Registration | null;
}

/**
 * Registrations that take part in one session. The cut is worked out once for the whole group; this only decides who
 * is in which session. Teams are always eligible; a linked session that does not take
 * independents leaves independent drivers out. A session on its own keeps everyone staff entered by hand.
 */
export function eligibleFor<T extends { kind: RegKind; teamId: string | null }>(regs: T[], s: Pick<RegSettings, "independents">, linked: boolean): T[] {
  return linked && !s.independents ? regs.filter((r) => r.kind !== "driver" || r.teamId) : regs;
}

interface CutInput {
  userId: string;
  kind: RegKind;
  teamId: string | null;
  denied: boolean;
  at: number;
}

/** Each factory team's first `factoryReserved` drivers, and how many reserved spots no factory driver has taken yet. */
function reserve(live: CutInput[], s: RegSettings, factoryIds: Set<string>, hold: boolean) {
  const cap = s.teamCap ?? Infinity;
  const reserved = new Set<string>();
  const perTeam = new Map<string, number>();
  const teamIn = (taken: Set<string>) => live.filter((r) => r.kind === "driver" && r.teamId && taken.has(r.userId)).length;
  for (const r of live) {
    if (r.kind !== "driver" || !r.teamId || !factoryIds.has(r.teamId)) continue;
    const n = perTeam.get(r.teamId) ?? 0;
    if (n < s.factoryReserved && reserved.size < s.drivers && teamIn(reserved) < cap) {
      reserved.add(r.userId);
      perTeam.set(r.teamId, n + 1);
    }
  }
  let unfilled = 0;
  if (hold) for (const id of factoryIds) unfilled += Math.max(0, s.factoryReserved - (perTeam.get(id) ?? 0));
  return { reserved, held: Math.min(unfilled, Math.max(0, s.drivers - reserved.size)) };
}

/** Driver spots kept free for factory teams that have not filled their reserved spots yet. */
export function heldSpots(regs: CutInput[], s: RegSettings, factoryIds: Set<string>): number {
  return reserve(regs.filter((r) => !r.denied && r.kind === "driver").sort((a, b) => a.at - b.at), s, factoryIds, true).held;
}

/**
 * Who is In. Spots go in the order people registered. The only exception: each factory team has `factoryReserved`
 * spots for its own drivers, kept free until they are taken. Denied people drop out and the next in line moves up.
 */
export function computeCut(regs: CutInput[], s: RegSettings, factoryIds: Set<string>, hold = true): Map<string, Cut> {
  const out = new Map<string, Cut>();
  const live = regs.filter((r) => !r.denied).sort((a, b) => a.at - b.at);
  for (const r of regs) if (r.denied) out.set(r.userId, "denied");
  const cap = s.teamCap ?? Infinity;
  const teamIn = (taken: Set<string>) => regs.filter((r) => r.kind === "driver" && r.teamId && taken.has(r.userId)).length;
  const fill = (list: CutInput[], spots: number, taken: Set<string>, capped = false) => {
    let left = spots - taken.size;
    let teams = capped ? teamIn(taken) : 0;
    for (const r of list) {
      if (taken.has(r.userId)) continue;
      if (capped && r.teamId && teams >= cap) continue;
      if (left > 0) {
        if (capped && r.teamId) teams++;
        taken.add(r.userId);
        left--;
      }
    }
    return taken;
  };
  const drivers = live.filter((r) => r.kind === "driver");
  const { reserved, held } = reserve(drivers, s, factoryIds, hold);
  const driversIn = fill(drivers, s.drivers - held, reserved, true);
  const employeesIn = fill(live.filter((r) => r.kind === "employee"), s.employees, new Set());
  const spectatorsIn = fill(live.filter((r) => r.kind === "spectator"), s.spectators, new Set());
  for (const r of live) {
    const inn = r.kind === "driver" ? driversIn : r.kind === "employee" ? employeesIn : spectatorsIn;
    out.set(r.userId, inn.has(r.userId) ? "in" : "waitlist");
  }
  return out;
}

// ---- Endurance: spots count cars --------------------------------------------------------------

/** A car as the cut sees it: its team, when it was created, and its ranked drivers (user ids). */
export interface EntryInput {
  id: string;
  teamId: string;
  at: number;
  drivers: string[];
}

/** A car's drivers that are really in it: registered by the same team, not denied, and in no earlier car. Ranks close up. */
export function lineupOf(entries: EntryInput[], regs: { userId: string; kind: RegKind; teamId: string | null; denied: boolean }[]): Map<string, string[]> {
  const ok = new Map(regs.filter((r) => r.kind === "driver" && r.teamId && !r.denied).map((r) => [r.userId, r.teamId]));
  const seen = new Set<string>();
  const out = new Map<string, string[]>();
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    const list = e.drivers.filter((u) => ok.get(u) === e.teamId && !seen.has(u));
    for (const u of list) seen.add(u);
    out.set(e.id, list);
  }
  return out;
}

/**
 * The seat rule: the first `seats` drivers by rank race and the rest are reserve. With attendance, drivers who are not
 * present are skipped, so everyone below moves up. Without it (`present` is null) the lineup is taken as ranked.
 */
export function raceDrivers(lineup: string[], seats: number, present: Set<string> | null = null): string[] {
  return (present ? lineup.filter((u) => present.has(u)) : lineup).slice(0, Math.max(0, seats));
}

/**
 * Who is In when the driver spots are cars. A car with at least one registered driver is one unit, in the order the car
 * was created, and each independent driver is a one-driver car. The rest works as for drivers: reserved spots per factory
 * team, the team cap, the waiting list. Every driver of a car has the car's result. A team driver who is in no car is "out".
 */
export function computeEnduranceCut(
  regs: CutInput[],
  entries: EntryInput[],
  s: RegSettings,
  factoryIds: Set<string>,
  hold = true,
): { cut: Map<string, Cut>; carCut: Map<string, "in" | "waitlist">; held: number; driverWait: Map<string, number>; carWait: Map<string, number> } {
  const lineups = lineupOf(entries, regs);
  const unitOf = new Map<string, string>();
  const units: CutInput[] = [];
  for (const e of entries) {
    const list = lineups.get(e.id) ?? [];
    for (const u of list) unitOf.set(u, `car:${e.id}`);
    if (list.length) units.push({ userId: `car:${e.id}`, kind: "driver", teamId: e.teamId, denied: false, at: e.at });
  }
  for (const r of regs) if (r.kind === "driver" && !r.teamId) units.push(r);
  const others = regs.filter((r) => r.kind !== "driver");
  const base = computeCut([...units, ...others], s, factoryIds, hold);
  const cut = new Map<string, Cut>();
  for (const r of regs) {
    if (r.denied) cut.set(r.userId, "denied");
    else if (r.kind !== "driver" || !r.teamId) cut.set(r.userId, base.get(r.userId) ?? "waitlist");
    else cut.set(r.userId, base.get(unitOf.get(r.userId) ?? "") ?? "out");
  }
  const carCut = new Map<string, "in" | "waitlist">();
  for (const e of entries) carCut.set(e.id, base.get(`car:${e.id}`) === "in" ? "in" : "waitlist");
  // Place on the waiting list, per car (or independent), in the order cars were created.
  const waiting = units.filter((u) => base.get(u.userId) === "waitlist").sort((a, b) => a.at - b.at);
  const driverWait = new Map<string, number>();
  const carWait = new Map<string, number>();
  waiting.forEach((u, i) => {
    if (u.userId.startsWith("car:")) carWait.set(u.userId.slice(4), i + 1);
    else driverWait.set(u.userId, i + 1);
  });
  for (const [u, unit] of unitOf) if (unit.startsWith("car:") && carWait.has(unit.slice(4))) driverWait.set(u, carWait.get(unit.slice(4))!);
  return { cut, carCut, held: heldSpots(units, s, factoryIds), driverWait, carWait };
}

/** Place on the waiting list of each person who is Waiting, per kind, in registration order. */
export function waitPositions(regs: { userId: string; kind: RegKind; at: number; cut: Cut }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of REG_KINDS) {
    regs
      .filter((r) => r.kind === k && r.cut === "waitlist")
      .sort((a, b) => a.at - b.at)
      .forEach((r, i) => out.set(r.userId, i + 1));
  }
  return out;
}

// ---- Wording, shared so every screen says the same thing -------------------------------------

/** "In", "Waiting, position 2", "Denied". */
export function statusText(r: Pick<Registration, "cut" | "waitPos">): string {
  return r.cut === "waitlist" && r.waitPos ? `Waiting, position ${r.waitPos}` : CUT_LABEL[r.cut];
}

/** The one sentence that says how spots are given out. */
export function orderRule(s: Pick<RegSettings, "factoryReserved">): string {
  return s.factoryReserved > 0
    ? `Spots go in the order people registered. The only exception is that each factory team has ${s.factoryReserved} reserved ${s.factoryReserved === 1 ? "spot" : "spots"} for its own drivers. Nobody else can take those.`
    : "Spots go in the order people registered.";
}

/** "8 of 10 taken, 2 waiting" for one kind of spot. */
export function spotsLine(c: SpotCount, unit = ""): string {
  const free = Math.max(0, c.spots - c.taken - c.held);
  return `${c.taken} of ${c.spots}${unit ? ` ${unit}` : ""} taken${c.held > 0 ? `, ${c.held} held for factory teams` : ""}${free > 0 ? `, ${free} free` : ""}${c.waiting > 0 ? `, ${c.waiting} waiting` : ""}`;
}

/** What is said before registering while no spot is free. Null while one is free. `team` words it for a team registering drivers. */
export function fullNotice(c: SpotCount, noun: string, opts: { ownReserved?: boolean; team?: boolean } = {}): string | null {
  if (c.spots - c.taken - c.held > 0 || (opts.ownReserved && c.held > 0)) return null;
  const spots = `All ${noun} spots are taken${c.held > 0 ? " or held for factory teams" : ""}. Registration is still open.`;
  return opts.team
    ? `${spots} A driver you register now will be Waiting, from position ${c.waiting + 1}, and moves up when someone ahead withdraws or is denied.`
    : `${spots} If you register now you will be Waiting, position ${c.waiting + 1}, and you move up when someone ahead of you withdraws or is denied.`;
}

/** What the driver spots are called: "cars" in an endurance event, "drivers" otherwise. */
export const driverUnit = (s: Pick<RegSettings, "endurance"> | null | undefined) => (s?.endurance ? "cars" : "drivers");

/** "Racing: 3 · Reserve: 2" for a car's lineup. */
export function lineupLine(drivers: number, seats: number): string {
  return `Racing: ${Math.min(drivers, seats)} · Reserve: ${Math.max(0, drivers - seats)}`;
}

/** When a team's lineups lock: the first session's pick cutoff, or its start when none is set. */
export const lineupLockAt = (pickCutoff: number | null, startsAt: number | null): number | null => pickCutoff ?? startsAt;

/** Moves one entry of a ranked list up (-1) or down (1); the list as it is when the move would leave it. */
export function moveRank<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** The car as the team and staff name it: "#12 Team car". */
export const carName = (c: { label: string; number: string | null }) => (c.number ? `#${c.number} ${c.label}` : c.label);

const list = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? ""));

/** Who takes part in which session of a group, from each session's own settings. Empty when the session is not linked. */
export function groupSummary(group: RegGroupMember[]): { independents: string; teams: string } | null {
  if (group.length < 2) return null;
  const open = group.filter((m) => !m.teamsOnly).map((m) => m.name);
  const teams = group.map((m) => m.name);
  const closed = group.filter((m) => m.teamsOnly).map((m) => m.name);
  return {
    independents: closed.length === 0 ? `Independent drivers take part in ${list(open)}.` : open.length === 0 ? "Independent drivers cannot take part." : `Independent drivers take part in ${list(open)} only and cannot take part in ${list(closed)}.`,
    teams: `Team drivers are registered for ${list(teams)} with one registration.`,
  };
}

/**
 * Applies a per-team limit to a session: each team fields at most `limit` of the drivers that made the cut.
 * A team that has chosen fields its choice; a team that has not fields its first registered drivers.
 */
export function applyTeamLimit<T extends { userId: string; kind: RegKind; teamId: string | null; cut: Cut; at: number }>(regs: T[], limit: number | null, picks: Set<string>): T[] {
  if (limit === null) return regs;
  const out = new Map<string, Cut>();
  const byTeam = new Map<string, T[]>();
  for (const r of regs) if (r.kind === "driver" && r.teamId && r.cut === "in") byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r]);
  for (const list of byTeam.values()) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    const chosen = sorted.filter((r) => picks.has(r.userId));
    const fielded = new Set((chosen.length ? chosen : sorted).slice(0, limit).map((r) => r.userId));
    for (const r of list) if (!fielded.has(r.userId)) out.set(r.userId, "out");
  }
  return regs.map((r) => (out.has(r.userId) ? { ...r, cut: out.get(r.userId)! } : r));
}

/** What the event registration page shows: the race, and for each session with a registration its group's first session and view. */
export interface EventView {
  race: import("./types").RaceSummary;
  sessions: Record<string, { root: string; view: RegistrationView }>;
}
