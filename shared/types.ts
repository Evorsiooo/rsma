export interface RaceSummary {
  id: string;
  name: string;
  expiresAt: number;
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

export interface AdminTeam extends Team {
  members: { id: string; username: string }[];
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  lastLogin: number | null;
  roles: Role[];
}

export interface AdminRace {
  id: string;
  name: string;
  status: "active" | "archived";
  expiresAt: number;
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
