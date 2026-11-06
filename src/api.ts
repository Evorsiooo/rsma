import type { AdminRace, AdminUser, Me, RaceSummary, Role, SystemInfo } from "../shared/types";
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
  races: () => get<RaceSummary[]>("/api/races"),
};

export async function sendCommand(raceId: string, cmd: Command): Promise<string | null> {
  const res = await fetch(`/api/races/${raceId}/cmd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? "failed";
}

export const raceAccess = (id: string) => get<{ steward: boolean }>(`/api/races/${id}/access`);

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
  system: () => get<SystemInfo>("/api/admin/system"),
};
