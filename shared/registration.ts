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
}

export interface RegTeam {
  id: string;
  name: string;
  members: { id: string; username: string; roles: import("./teams").TeamRole[] }[];
}

export interface RegistrationView {
  settings: RegSettings | null;
  /** Until when teams can choose who they field, when this session has a team limit. */
  pickUntil: number | null;
  /** Sessions this registration covers, in start order; one entry when the session is not linked. */
  group: RegGroupMember[];
  phase: RegPhase | null;
  /** Taken and total spots per kind, denied people excluded. */
  counts: Record<RegKind, { taken: number; spots: number }>;
  staff: boolean;
  /** Teams the viewer registers for. */
  teams: RegTeam[];
  /** Staff see everyone, team managers their teams, an independent their own. */
  registrations: Registration[];
  /** The viewer's own registration, if any. */
  self: Registration | null;
}

/**
 * Registrations that count for one session. Teams are always eligible; a linked session that does not take
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

/**
 * Who makes the cut. Factory teams keep their first `factoryReserved` drivers; the remaining driver
 * spots go first come first served. Denied people drop out and the next in line moves up.
 */
export function computeCut(regs: CutInput[], s: RegSettings, factoryIds: Set<string>): Map<string, Cut> {
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
  const reserved = new Set<string>();
  const perTeam = new Map<string, number>();
  for (const r of drivers) {
    if (!r.teamId || !factoryIds.has(r.teamId)) continue;
    const n = perTeam.get(r.teamId) ?? 0;
    if (n < s.factoryReserved && reserved.size < s.drivers && teamIn(reserved) < cap) {
      reserved.add(r.userId);
      perTeam.set(r.teamId, n + 1);
    }
  }
  const driversIn = fill(drivers, s.drivers, reserved, true);
  const employeesIn = fill(live.filter((r) => r.kind === "employee"), s.employees, new Set());
  const spectatorsIn = fill(live.filter((r) => r.kind === "spectator"), s.spectators, new Set());
  for (const r of live) {
    const inn = r.kind === "driver" ? driversIn : r.kind === "employee" ? employeesIn : spectatorsIn;
    out.set(r.userId, inn.has(r.userId) ? "in" : "waitlist");
  }
  return out;
}

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
