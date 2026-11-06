import type { Me, RaceSummary } from "../shared/types";
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
