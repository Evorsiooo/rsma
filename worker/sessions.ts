import type { RaceSummary, SessionInfo, SessionSummary } from "../shared/types";

const SESSION_COLS = "id, race_id AS raceId, name, type, starts_at AS startsAt, ends_at AS endsAt";
const RACE_COLS = "id, name, expires_at AS expiresAt, (status = 'archived' OR expires_at <= ?1) AS ended";

type RaceRow = Omit<RaceSummary, "ended" | "sessions"> & { ended: number };

export async function sessionsOf(db: D1Database, raceIds: string[]): Promise<Map<string, SessionSummary[]>> {
  const map = new Map<string, SessionSummary[]>(raceIds.map((id) => [id, []]));
  if (!raceIds.length) return map;
  const { results } = await db
    .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE race_id IN (${raceIds.map(() => "?").join(",")}) ORDER BY position, starts_at`)
    .bind(...raceIds)
    .all<SessionSummary>();
  for (const s of results) map.get(s.raceId)?.push(s);
  return map;
}

/** Races matching a WHERE/ORDER clause that uses ?1 for "now", each with its ordered sessions. */
export async function loadRaces(db: D1Database, clause: string, ...extra: unknown[]): Promise<RaceSummary[]> {
  const { results } = await db
    .prepare(`SELECT ${RACE_COLS} FROM races ${clause}`)
    .bind(Date.now(), ...extra)
    .all<RaceRow>();
  const sessions = await sessionsOf(db, results.map((r) => r.id));
  return results.map((r) => ({ ...r, ended: !!r.ended, sessions: sessions.get(r.id) ?? [] }));
}

export async function loadSession(db: D1Database, id: string): Promise<SessionInfo | null> {
  const session = await db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`).bind(id).first<SessionSummary>();
  if (!session) return null;
  const [race] = await loadRaces(db, "WHERE id = ?2", session.raceId);
  return race ? { session, race } : null;
}
