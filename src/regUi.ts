import { regPhase, type RegPhase, type RegSummary } from "../shared/registration";
import { hasAny, MANAGER_ROLES } from "../shared/teams";
import type { Me, RaceSummary, SessionSummary } from "../shared/types";

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

/** Teams the person owns: Team Principal or Sporting Director, the roles that may register a team's drivers. */
export const ownedTeams = (me: Me | null) => (me ? me.memberships.filter((t) => hasAny(t.roles, MANAGER_ROLES)) : []);

/** Where a team owner goes to register: their team's page for the event. Everyone else registers as an independent. */
export const registerPath = (me: Me | null, raceId: string) => (ownedTeams(me).length > 0 ? `/race/${raceId}/register` : "/driver-registration");

/** One line per event that has a registration window: the open one if there is one, else the first. */
export function registrationEvents(sessions: UpcomingSession[], regs: RegSummary[], now: number) {
  return [...new Set(sessions.filter((u) => u.reg).map((u) => u.race))].map((race) => {
    const regsOf = sessions.filter((u) => u.race.id === race.id && u.reg).map((u) => regs.find((g) => g.sessionId === u.reg!.root) ?? u.reg!);
    return { race, reg: regsOf.find((g) => regStatus(g, now).phase === "open") ?? regsOf[0] };
  });
}
