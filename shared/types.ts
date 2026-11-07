import type { TeamRole } from "./teams";

export type SessionType = "practice" | "timed" | "race";

export interface SessionSummary {
  id: string;
  raceId: string;
  name: string;
  type: SessionType;
  startsAt: number;
  endsAt: number;
  /** Teams start and stop their own cars; stewards have no Go or Stop. */
  selfTimed: boolean;
  /** Stewards may stage drivers by hand; off unless the session has no registration to stage from. */
  staging: boolean;
}

export interface RaceSummary {
  id: string;
  name: string;
  expiresAt: number;
  /** In running order. */
  sessions: SessionSummary[];
  /** Archived or past its expiry: results stay visible, nothing can be changed. */
  ended: boolean;
}

export type Role = "admin" | "users" | "races" | "steward";

export interface Team {
  id: string;
  name: string;
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  roles: Role[];
  /** "token": signed in with an access code, which never carries global roles. */
  via: "roblox" | "token";
  /** Teams whose panel this user may open. */
  teams: Team[];
  /** Every team this user belongs to, with their roles. */
  memberships: (Team & { roles: TeamRole[] })[];
}

export type TeamKind = "factory" | "customer";

export interface AdminTeam extends Team {
  kind: TeamKind;
  /** Factory teams: their car. */
  car: string | null;
  /** Customer teams: the factory team whose car they run. */
  factoryId: string | null;
  factoryName: string | null;
  members: { id: string; username: string; roles: TeamRole[] }[];
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  lastLogin: number | null;
  roles: Role[];
}

/** One session with the event it belongs to. */
export interface SessionInfo {
  session: SessionSummary;
  race: RaceSummary;
}

export interface AdminRace {
  id: string;
  name: string;
  status: "active" | "archived";
  expiresAt: number;
  sessions: SessionSummary[];
  stewards: { id: string; username: string }[];
}

export interface SystemInfo {
  users: number;
  admins: number;
  activeRaces: number;
  expiredRaces: number;
  archivedRaces: number;
  robloxConfigured: boolean;
  /** Everything except the admin panel signs in with access codes. */
  tokenMode: boolean;
}

export interface MyTeam extends Team {
  kind: TeamKind;
  car: string | null;
  factoryName: string | null;
  /** The signed-in user's roles in this team. */
  roles: TeamRole[];
  members: { id: string; username: string; roles: TeamRole[] }[];
}
