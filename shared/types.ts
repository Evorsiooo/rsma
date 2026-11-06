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
