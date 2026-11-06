import type { AdminRace, AdminTeam, AdminUser, Me, RaceSummary, Role, SessionInfo, SessionType, SystemInfo, Team } from "../shared/types";
import type { Command } from "../shared/commands";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  me: () => get<Me | null>("/api/me"),
  logout: () => fetch("/api/auth/logout", { method: "POST" }),
  health: () => get<{ ok: boolean }>("/api/health"),
  race: (id: string) => get<RaceSummary>(`/api/races/${id}`),
  session: (id: string) => get<SessionInfo>(`/api/sessions/${id}`),
  races: () => get<RaceSummary[]>("/api/races"),
  pastRaces: () => get<RaceSummary[]>("/api/races/past"),
  teams: () => get<Team[]>("/api/teams"),
};

export async function sendCommand(raceId: string, cmd: Command): Promise<string | null> {
  const res = await fetch(`/api/sessions/${raceId}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "failed";
}

export async function sendTeamRadio(raceId: string, teamId: string, text: string, to: "team" | "stewards" = "team"): Promise<string | null> {
  const res = await fetch(`/api/sessions/${raceId}/team/${teamId}/radio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, to }),
  });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "failed";
}

export const raceAccess = (id: string) => get<{ steward: boolean }>(`/api/sessions/${id}/access`);

async function send(method: string, path: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string }).error ?? "failed" };
}

export const admin = {
  users: () => get<AdminUser[]>("/api/admin/users"),
  addUser: (username: string) => send("POST", "/api/admin/users", { username }),
  setRoles: (id: string, roles: Role[]) => send("PUT", `/api/admin/users/${id}/roles`, { roles }),
  races: () => get<AdminRace[]>("/api/admin/races"),
  createRace: (name: string, expiresAt: number) => send("POST", "/api/admin/races", { name, expiresAt }),
  patchRace: (id: string, patch: { name?: string; expiresAt?: number; status?: "active" | "archived" }) =>
    send("PATCH", `/api/admin/races/${id}`, patch),
  addSteward: (raceId: string, username: string) => send("POST", `/api/admin/races/${raceId}/stewards`, { username }),
  removeSteward: (raceId: string, userId: string) => send("DELETE", `/api/admin/races/${raceId}/stewards/${userId}`),
  createSession: (raceId: string, s: { name: string; type: SessionType; startsAt: number; endsAt: number; selfTimed?: boolean }) =>
    send("POST", `/api/admin/races/${raceId}/sessions`, s),
  patchSession: (id: string, patch: { name?: string; type?: SessionType; startsAt?: number; endsAt?: number; selfTimed?: boolean }) =>
    send("PATCH", `/api/admin/sessions/${id}`, patch),
  deleteSession: (id: string) => send("DELETE", `/api/admin/sessions/${id}`),
  teams: () => get<AdminTeam[]>("/api/admin/teams"),
  createTeam: (t: TeamFields & { name: string }) => send("POST", "/api/admin/teams", t),
  patchTeam: (id: string, t: TeamFields & { name: string }) => send("PATCH", `/api/admin/teams/${id}`, t),
  deleteTeam: (id: string) => send("DELETE", `/api/admin/teams/${id}`),
  addMember: (teamId: string, username: string) => send("POST", `/api/admin/teams/${teamId}/members`, { username }),
  removeMember: (teamId: string, userId: string) => send("DELETE", `/api/admin/teams/${teamId}/members/${userId}`),
  system: () => get<SystemInfo>("/api/admin/system"),
};

async function teamCall(method: string, path: string, body?: unknown): Promise<string | null> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "failed";
}

export const addPitWindow = (sessionId: string, teamId: string, fromMs: number, toMs: number) =>
  teamCall("POST", `/api/sessions/${sessionId}/team/${teamId}/pit`, { fromMs, toMs });
export const removePitWindow = (sessionId: string, teamId: string, windowId: string) =>
  teamCall("DELETE", `/api/sessions/${sessionId}/team/${teamId}/pit/${windowId}`);
export const moveOwnCar = (sessionId: string, teamId: string, runId: string, dir: -1 | 1) =>
  teamCall("POST", `/api/sessions/${sessionId}/team/${teamId}/move`, { runId, dir });
export const teamTiming = (sessionId: string, teamId: string, action: "go" | "finish", runId?: string) =>
  teamCall("POST", `/api/sessions/${sessionId}/team/${teamId}/timing`, { action, runId });
export const askDriver = (sessionId: string, teamId: string, driver: string, text: string, options?: string[]) =>
  teamCall("POST", `/api/sessions/${sessionId}/team/${teamId}/ask`, { driver, text, options });
export const answerAsk = (sessionId: string, msgId: string, index: number) =>
  teamCall("POST", `/api/sessions/${sessionId}/driver/answer`, { msgId, index });
export const driverRadio = (sessionId: string, text: string) => teamCall("POST", `/api/sessions/${sessionId}/driver/radio`, { text });

export interface TeamFields {
  kind: "factory" | "customer";
  car?: string;
  factoryId?: string;
}
export const teamRunCmd = (sessionId: string, teamId: string, cmd: object) => teamCall("POST", `/api/sessions/${sessionId}/team/${teamId}/run`, cmd);
