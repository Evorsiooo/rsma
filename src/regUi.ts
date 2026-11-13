import { regPhase, type RegPhase, type RegSummary } from "../shared/registration";
import type { RaceSummary, SessionSummary } from "../shared/types";

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtWhen = (ms: number) => fmt.format(ms);

/** "Registration opens 7 Nov, 10:00", "Registration closes 8 Nov, 12:00" or "Registration closed". */
export function regStatus(r: RegSummary, now: number): { phase: RegPhase; text: string } {
  const phase = regPhase(r, now);
  return { phase, text: phase === "upcoming" ? `Registration opens ${fmt.format(r.opensAt)}` : phase === "open" ? `Registration closes ${fmt.format(r.deadline)}` : "Registration closed" };
}

export interface UpcomingSession {
  race: RaceSummary;
  session: SessionSummary;
  reg: RegSummary | null;
}

/** Sessions that have not ended, in start order, with their registration window if they have one. */
export function upcomingSessions(races: RaceSummary[], regs: RegSummary[], now: number): UpcomingSession[] {
  return races
    .filter((r) => !r.ended)
    .flatMap((race) => race.sessions.filter((s) => s.endsAt > now).map((session) => ({ race, session, reg: regs.find((g) => g.sessionId === session.id) ?? null })))
    .sort((a, b) => a.session.startsAt - b.session.startsAt);
}
