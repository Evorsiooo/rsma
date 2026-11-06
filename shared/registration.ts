export type RegKind = "driver" | "employee" | "spectator";
export const REG_KINDS: RegKind[] = ["driver", "employee", "spectator"];
export const REG_KIND_LABEL: Record<RegKind, string> = { driver: "Driver", employee: "Employee", spectator: "Spectator" };

/** Roblox group membership: joined, join request pending, or not yet confirmed. */
export type GroupStatus = "joined" | "pending" | "unverified";
export const GROUP_STATUSES: GroupStatus[] = ["joined", "pending", "unverified"];
export const GROUP_LABEL: Record<GroupStatus, string> = { joined: "Joined", pending: "Pending", unverified: "Not confirmed" };
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
}

export type RegPhase = "upcoming" | "open" | "closed";
export const regPhase = (s: Pick<RegSettings, "opensAt" | "deadline">, now: number): RegPhase =>
  now < s.opensAt ? "upcoming" : now <= s.deadline ? "open" : "closed";

export type Cut = "in" | "waitlist" | "denied";

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
  const fill = (list: CutInput[], spots: number, taken: Set<string>) => {
    let left = spots - taken.size;
    for (const r of list) {
      if (taken.has(r.userId)) continue;
      if (left > 0) {
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
    if (n < s.factoryReserved && reserved.size < s.drivers) {
      reserved.add(r.userId);
      perTeam.set(r.teamId, n + 1);
    }
  }
  const driversIn = fill(drivers, s.drivers, reserved);
  const employeesIn = fill(live.filter((r) => r.kind === "employee"), s.employees, new Set());
  const spectatorsIn = fill(live.filter((r) => r.kind === "spectator"), s.spectators, new Set());
  for (const r of live) {
    const inn = r.kind === "driver" ? driversIn : r.kind === "employee" ? employeesIn : spectatorsIn;
    out.set(r.userId, inn.has(r.userId) ? "in" : "waitlist");
  }
  return out;
}
