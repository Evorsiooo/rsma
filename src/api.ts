import type { Me, RaceSummary } from "../shared/types";

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
