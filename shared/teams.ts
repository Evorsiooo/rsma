export type TeamRole = "principal" | "sporting_director" | "race_engineer" | "driver";

export const TEAM_ROLES: TeamRole[] = ["principal", "sporting_director", "race_engineer", "driver"];

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  principal: "Team Principal",
  sporting_director: "Sporting Director",
  race_engineer: "Race Engineer",
  driver: "Driver",
};

/** Roles that open the team panel in a session. */
export const PANEL_ROLES: TeamRole[] = ["principal", "sporting_director", "race_engineer"];
/** Roles that may add and remove people. */
export const MANAGER_ROLES: TeamRole[] = ["principal", "sporting_director"];

export const parseRoles = (s: string | null | undefined): TeamRole[] =>
  TEAM_ROLES.filter((r) => (s ?? "").split(",").includes(r));

export const hasAny = (roles: TeamRole[], wanted: TeamRole[]) => roles.some((r) => wanted.includes(r));

/** Validate a roles array from a request; null when invalid or empty. */
export function cleanRoles(v: unknown): TeamRole[] | null {
  if (!Array.isArray(v) || !v.every((r) => TEAM_ROLES.includes(r as TeamRole))) return null;
  const roles = TEAM_ROLES.filter((r) => v.includes(r));
  return roles.length ? roles : null;
}
