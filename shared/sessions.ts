import type { SessionSummary } from "./types.ts";

/** The session to show by default: running now, else the next one to start, else the last one. */
export function currentSession(sessions: SessionSummary[], now: number): SessionSummary | undefined {
  return (
    sessions.find((s) => s.startsAt <= now && now < s.endsAt) ??
    sessions.filter((s) => s.startsAt > now).sort((a, b) => a.startsAt - b.startsAt)[0] ??
    sessions[sessions.length - 1]
  );
}

/** mm:ss, or h:mm:ss from an hour up. */
export function fmtClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type SessionPhase = { phase: "upcoming" | "running" | "ended"; ms: number };

/** Where a session is relative to `now`; `ms` is the time until it starts, or until it ends while running. */
export function sessionPhase(s: Pick<SessionSummary, "startsAt" | "endsAt">, now: number): SessionPhase {
  if (now < s.startsAt) return { phase: "upcoming", ms: s.startsAt - now };
  if (now < s.endsAt) return { phase: "running", ms: s.endsAt - now };
  return { phase: "ended", ms: 0 };
}
