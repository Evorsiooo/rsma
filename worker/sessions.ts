import type { RaceSummary, SessionInfo, SessionSummary } from "../shared/types";

const SESSION_COLS = "id, race_id AS raceId, name, type, starts_at AS startsAt, ends_at AS endsAt, self_timed AS selfTimed, staging";

type SessionRow = Omit<SessionSummary, "selfTimed" | "staging"> & { selfTimed: number; staging: number };
const toSession = (r: SessionRow): SessionSummary => ({ ...r, selfTimed: !!r.selfTimed, staging: !!r.staging });
const RACE_COLS = "id, name, expires_at AS expiresAt, (status = 'archived' OR expires_at <= ?1) AS ended";

type RaceRow = Omit<RaceSummary, "ended" | "sessions"> & { ended: number };

export async function sessionsOf(db: D1Database, raceIds: string[]): Promise<Map<string, SessionSummary[]>> {
  const map = new Map<string, SessionSummary[]>(raceIds.map((id) => [id, []]));
  if (!raceIds.length) return map;
  const { results } = await db
    .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE race_id IN (${raceIds.map(() => "?").join(",")}) ORDER BY starts_at, position`)
    .bind(...raceIds)
    .all<SessionRow>();
  for (const r of results) map.get(r.raceId)?.push(toSession(r));
  return map;
}

/** Races matching a WHERE/ORDER clause that uses ?1 for "now", each with its ordered sessions. One round trip to the database. */
export async function loadRaces(db: D1Database, clause: string, ...extra: unknown[]): Promise<RaceSummary[]> {
  const args = [Date.now(), ...extra];
  const [races, sessions] = await db.batch([
    db.prepare(`SELECT ${RACE_COLS} FROM races ${clause}`).bind(...args),
    db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE race_id IN (SELECT id FROM races ${clause}) ORDER BY starts_at, position`).bind(...args),
  ]);
  const by = new Map<string, SessionSummary[]>();
  for (const r of sessions.results as SessionRow[]) by.set(r.raceId, [...(by.get(r.raceId) ?? []), toSession(r)]);
  return (races.results as RaceRow[]).map((r) => ({ ...r, ended: !!r.ended, sessions: by.get(r.id) ?? [] }));
}

export async function loadSession(db: D1Database, id: string): Promise<SessionInfo | null> {
  const [race] = await loadRaces(db, "WHERE id = (SELECT race_id FROM sessions WHERE id = ?2)", id);
  const session = race?.sessions.find((x) => x.id === id);
  return race && session ? { session, race } : null;
}
