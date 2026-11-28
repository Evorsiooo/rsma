import { carText, type Row } from "./race.ts";
import type { SessionSummary } from "./types.ts";

/**
 * The session whose times set a race's starting grid. A race that names one uses it; otherwise it is the latest timed event
 * that starts before the race; "none" and a race with nothing before it have no grid. Null when there is no grid.
 */
export function qualifyingOf(race: Pick<SessionSummary, "id" | "startsAt" | "qualifyingSession">, sessions: Pick<SessionSummary, "id" | "type" | "startsAt">[]): string | null {
  const q = race.qualifyingSession;
  if (q === "none") return null;
  if (q) return sessions.some((s) => s.id === q && s.id !== race.id) ? q : null;
  const before = sessions.filter((s) => s.type === "timed" && s.startsAt < race.startsAt).sort((a, b) => b.startsAt - a.startsAt);
  return before[0]?.id ?? null;
}

export interface GridRow {
  position: number;
  /** Endurance: the car. Null for a driver on their own. */
  entry: string | null;
  number?: string;
  /** The team and car, or the driver's team. */
  car: string;
  /** The driver whose time sets the place. */
  driver: string;
  ms: number;
  /** Faster drivers of the same car who are not racing, so the time used is a later one. */
  skipped: string[];
  /** Registered after qualifying: starts from the pit lane, after the qualified cars. */
  pit?: boolean;
  /** Pit lane because no racing driver set a qualifying time (not because of a late registration). */
  noTime?: boolean;
}

/**
 * The starting grid from a qualifying session's classified rows. A car's place is its fastest time among the drivers who
 * are racing; `present` is null when nobody was asked (everyone counts). A car with no racing driver who set a time has no place.
 */
export function computeGrid(rows: Row[], present: Set<string> | null): GridRow[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.status !== "finished" || r.finalMs == null) continue;
    const key = r.entry ?? `driver:${r.name.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: Omit<GridRow, "position">[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.finalMs! - b.finalMs!);
    const here = sorted.find((r) => !present || present.has(r.name.toLowerCase()));
    if (!here) continue;
    const skipped = sorted.filter((r) => r.finalMs! < here.finalMs! && present && !present.has(r.name.toLowerCase())).map((r) => r.name);
    out.push({ entry: here.entry ?? null, number: here.number, car: carText(here), driver: here.name, ms: here.finalMs!, skipped });
  }
  out.sort((a, b) => a.ms - b.ms);
  return out.map((r, i) => ({ ...r, position: i + 1 }));
}
