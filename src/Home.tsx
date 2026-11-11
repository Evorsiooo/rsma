import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { classify, fmtTime, type Row } from "../shared/race";
import { currentSession } from "../shared/sessions";
import { regPhase, type RegSummary } from "../shared/registration";
import type { RaceSummary, SessionSummary } from "../shared/types";
import { api, registrationApi } from "./api";
import { useBootData } from "./Layouts";
import { Bd, Box } from "./site/parts";

const AUTH_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  state: "Sign-in expired. Try again.",
  token: "Roblox rejected the sign-in.",
  profile: "Could not read your Roblox profile.",
};

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function EventRows({ races, label, primary, until }: { races: RaceSummary[]; label: string; primary?: boolean; until?: boolean }) {
  return (
    <table className="t">
      <tbody>
        {races.map((r) => (
          <tr key={r.id}>
            <td><b>{r.name}</b></td>
            <td>{until ? "Until " : ""}{fmt.format(r.expiresAt)}</td>
            <td className="n"><Link className={`btn sm${primary ? " pri" : ""}`} to={`/race/${r.id}`}>{label}</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function About() {
  return (
    <Box title="About the RSMA">
      <Bd>
        <p style={{ marginBottom: 6 }}>
          The Ro-State Motorsport Association runs rally and time-trial events in Roblox. Teams register their drivers for each session and have reserved slots, and independent drivers can register too.
        </p>
        <div className="bar">
          <Link className="btn pri" to="/team-registration">Register a Team</Link>
          <Link className="btn" to="/driver-registration">Driver Registration</Link>
        </div>
      </Bd>
    </Box>
  );
}

const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const when = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** The next session that has not started, with a Register button while its registration is open. */
function NextEvent({ races, regs }: { races: RaceSummary[]; regs: RegSummary[] }) {
  const now = Date.now();
  const next = races
    .flatMap((race) => race.sessions.filter((s) => s.startsAt > now).map((session) => ({ race, session })))
    .sort((a, b) => a.session.startsAt - b.session.startsAt)[0];
  if (!next) return null;
  const reg = regs.find((r) => r.sessionId === next.session.id);
  const open = !!reg && regPhase(reg, now) === "open";
  return (
    <Box title="Next Event">
      <Bd>
        <div className="bar between">
          <span>
            <b>{next.race.name} &middot; {next.session.name}</b>
            <br />
            <span className="mute">{when.format(next.session.startsAt)}</span>
          </span>
          <span className="bar">
            {open && <Link className="btn pri" to="/driver-registration">Register</Link>}
            <Link className="btn" to={`/session/${next.session.id}`}>Timing</Link>
          </span>
        </div>
      </Bd>
    </Box>
  );
}

/** Top three of the latest finished event. */
function LatestResults({ race }: { race: RaceSummary }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const session: SessionSummary | undefined = currentSession(race.sessions, Date.now());
  useEffect(() => {
    if (!session) return setRows([]);
    api.sessionState(session.id).then(
      (f) => setRows(classify(f.state.runs).filter((r) => r.status === "finished").slice(0, 3)),
      () => setRows([]),
    );
  }, [session?.id]);
  return (
    <Box title="Latest Results">
      {session && (
        <Bd>
          <b>{race.name} &middot; {session.name}</b>
          <br />
          <span className="mute">{dateOnly.format(session.startsAt)}</span>
        </Bd>
      )}
      <Bd flush>
        {rows && rows.length > 0 ? (
          <table className="t">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="pos">{r.rank}</td>
                  <td><b>{r.name}</b>{r.teamName && <span className="mute"> &middot; {r.teamName}</span>}</td>
                  <td className="n fin">{r.finalMs != null ? fmtTime(r.finalMs) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="bd note">{rows ? "No results recorded." : "Loading..."}</div>
        )}
      </Bd>
      <Bd top><Link className="btn" to={`/race/${race.id}`}>Full results</Link></Bd>
    </Box>
  );
}

export function Home() {
  const races = useBootData()?.races ?? [];
  const [past, setPast] = useState<RaceSummary[]>([]);
  const [regs, setRegs] = useState<RegSummary[]>([]);
  useEffect(() => {
    api.pastRaces().then((p) => setPast([...p].sort((a, b) => b.expiresAt - a.expiresAt)), () => {});
    registrationApi.list().then(setRegs, () => {});
  }, []);
  const [authError] = useState(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("auth_error");
    const detail = params.get("detail");
    if (code) history.replaceState(null, "", "/");
    if (!code) return null;
    const base = AUTH_ERRORS[code] ?? "Sign-in failed.";
    return detail ? `${base} (${detail})` : base;
  });
  return (
    <>
      {authError && <div className="err">{authError}</div>}
      <About />
      <NextEvent races={races} regs={regs} />
      <Box title="Events">
        <Bd flush>{races.length === 0 ? <div className="bd note">No active events.</div> : <EventRows races={races} label="Timing" primary until />}</Bd>
      </Box>
      {past.length > 0 && (
        <div className="g2">
          <Box title="Past Events">
            <Bd flush><EventRows races={past} label="Results" /></Bd>
          </Box>
          <LatestResults race={past[0]} />
        </div>
      )}
    </>
  );
}
