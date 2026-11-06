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
  /** Teams whose panel this user may open. */
  teams: Team[];
}

export type TeamKind = "factory" | "customer";

export interface AdminTeam extends Team {
  kind: TeamKind;
  /** Factory teams: their car. */
  car: string | null;
  /** Customer teams: the factory team whose car they run. */
  factoryId: string | null;
  factoryName: string | null;
  members: { id: string; username: string }[];
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
}
