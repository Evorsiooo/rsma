export interface RaceSummary {
  id: string;
  name: string;
  expiresAt: number;
}

export type Role = "admin" | "users" | "races" | "steward";

export interface Me {
  id: string;
  username: string;
  displayName: string;
  roles: Role[];
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
