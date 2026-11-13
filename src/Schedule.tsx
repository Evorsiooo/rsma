import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { RegSummary } from "../shared/registration";
import type { RaceSummary, SessionSummary, SessionType } from "../shared/types";
import { api, registrationApi } from "./api";
import { regStatus } from "./regUi";
import { Bd, Box } from "./site/parts";

const TYPE_LABEL: Record<SessionType, string> = { practice: "Practice", timed: "Timed event", race: "Race" };

const day = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" });
const zoneName = (ms: number) => zone.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";

/** Date and time range of a session; the end carries its own date when the session runs past midnight. */
export function whenText(startsAt: number, endsAt: number): { date: string; time: string } {
  const sameDay = day.format(startsAt) === day.format(endsAt);
  return { date: day.format(startsAt), time: `${clock.format(startsAt)} to ${sameDay ? "" : `${day.format(endsAt)}, `}${clock.format(endsAt)}` };
}

/** Upcoming and running sessions of events that have not ended, race by race in start order. */
export function upcomingByRace(races: RaceSummary[], now: number): { race: RaceSummary; sessions: SessionSummary[] }[] {
  return races
    .filter((r) => !r.ended)
    .map((race) => ({ race, sessions: race.sessions.filter((s) => s.endsAt > now).sort((a, b) => a.startsAt - b.startsAt) }))
    .filter((g) => g.sessions.length > 0)
    .sort((a, b) => a.sessions[0].startsAt - b.sessions[0].startsAt);
}

/** Public schedule: upcoming sessions in the viewer's own time zone, with how to register. */
export function Schedule() {
  const [races, setRaces] = useState<RaceSummary[] | null>(null);
  const [regs, setRegs] = useState<RegSummary[]>([]);
  useEffect(() => {
    api.races().then(setRaces, () => setRaces([]));
    registrationApi.list().then(setRegs, () => {});
  }, []);
  const now = Date.now();
  const groups = races ? upcomingByRace(races, now) : [];
  const all = races?.flatMap((r) => r.sessions) ?? [];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <Box title="Schedule">
        <Bd>
          <p>
            All times are in your time zone{tz ? `: ${tz.replace(/_/g, " ")}` : ""}{groups.length > 0 ? ` (${zoneName(groups[0].sessions[0].startsAt)})` : ""}.
          </p>
        </Bd>
      </Box>
      {races && groups.length === 0 && <Box title="Upcoming"><Bd><div className="note">No sessions are scheduled.</div></Bd></Box>}
      {!races && <Box title="Upcoming"><Bd><div className="note">Loading...</div></Bd></Box>}
      {groups.map(({ race, sessions }) => (
        <Box key={race.id} title={race.name}>
          <Bd flush>
            <table className="t">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Starts</th>
                  <th>Registration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const reg = regs.find((r) => r.sessionId === s.id);
                  const head = reg && reg.root !== s.id ? all.find((x) => x.id === reg.root) : undefined;
                  const st = reg ? regStatus(reg, now) : null;
                  const live = s.startsAt <= now;
                  const when = whenText(s.startsAt, s.endsAt);
                  const note = [head ? `Same registration as ${head.name}` : st?.text, reg?.teamsOnly ? "Teams only" : "", reg?.teamLimit != null ? `${reg.teamLimit} drivers per team` : ""].filter(Boolean).join(" · ");
                  return (
                    <tr key={s.id}>
                      <td><b>{s.name}</b> <span className="mute">{TYPE_LABEL[s.type]}</span></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {live ? <><b>Live now</b><br /><span className="mute">until {clock.format(s.endsAt)}</span></> : <>{when.date}<br /><span className="mute">{when.time}</span></>}
                      </td>
                      <td className="mute">{note}</td>
                      <td className="n">
                        {!head && st?.phase === "open" && <Link className="btn pri sm" to="/driver-registration">Register</Link>}{" "}
                        <Link className="btn sm" to={`/session/${s.id}`}>Timing</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Bd>
        </Box>
      ))}
    </>
  );
}
