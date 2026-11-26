import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { classify } from "../shared/race";
import { eventPoints, type ResultRow } from "../shared/standings";
import type { SessionInfo } from "../shared/types";
import { api, raceAccess } from "./api";
import { useMe } from "./me";
import { NotFound } from "./NotFound";
import { Bd, Box, FlagBar, ResultsTable } from "./site/parts";
import { EnteredResults } from "./EnteredResults";
import { SessionSelect } from "./SessionSelect";
import { StartingGrid } from "./StartingGrid";
import { sessionCountdown, useClock } from "./ui";
import { useRaceLive } from "./useRaceLive";

export function RacePage() {
  const { id = "" } = useParams();
  const [info, setInfo] = useState<SessionInfo | null | undefined>(undefined);
  const { state, live, offset } = useRaceLive(id);
  const [points, setPoints] = useState<Map<string, number> | undefined>();
  const now = useClock(offset);
  const { me } = useMe();
  const [steward, setSteward] = useState(false);
  const [entered, setEntered] = useState<{ results: ResultRow[]; points: number[] | null } | null>(null);

  useEffect(() => {
    setInfo(undefined);
    api.session(id).then(setInfo, () => setInfo(null));
  }, [id]);

  // The server decides who stewards this race (admins, the global steward role, the race's steward list).
  useEffect(() => {
    setSteward(false);
    if (me) raceAccess(id).then((a) => setSteward(a.steward), () => {});
  }, [id, me]);

  // Results typed in against the session (races have no live timing).
  useEffect(() => {
    setEntered(null);
    fetch(`/api/sessions/${id}/results`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ results: ResultRow[]; points: number[] | null }>) : null)).then((d) => d && d.results.length > 0 && setEntered(d), () => {});
  }, [id]);

  // A championship session shows the points each driver is awarded.
  const finishedN = state ? state.runs.filter((r) => r.status === "finished").length : 0;
  useEffect(() => {
    setPoints(undefined);
    api.standings().then(
      (d) => {
        const ev = d.events.find((e) => e.sessionId === id);
        if (!ev || ev.entered) return;
        const sorted = [...ev.results].sort((a, b) => a.position - b.position);
        const pts = eventPoints(ev, d.config);
        setPoints(new Map(sorted.map((r, i) => [r.username.toLowerCase(), pts[i]])));
      },
      () => {},
    );
  }, [id, finishedN]);

  if (info === null) return <NotFound />;
  const race = info?.race;
  const cd = info ? sessionCountdown(info.session, now) : null;
  const rows = state ? classify(state.runs) : [];

  const finished = rows.filter((r) => r.status === "finished").length;
  return (
    <>
      {(info || !race?.ended) && (
        <div className="bar between">
          <span className="bar">
            {info && <SessionSelect sessions={info.race.sessions} current={info.session.id} />}
            {cd && !race?.ended && <b>{cd.phase === "ended" ? "Session ended" : `${cd.label} ${cd.value}`}</b>}
          </span>
          <span className="bar">
            {steward && <Link className="btn" to={`/session/${id}/steward`}>Stewards</Link>}
            {!race?.ended && (
              <button
                className="btn"
                onClick={() => window.open(`/session/${id}/driver`, `flagman-radio-${id}`, "popup,width=340,height=640")}
              >
                Radio
              </button>
            )}
          </span>
        </div>
      )}
      <FlagBar flag={state?.flag} ended={race?.ended} live={live} />
      {info?.session.type === "race" && !race?.ended && !entered && <div className="notice">Live timing is not available for races.</div>}
      {info?.session.selfTimed && !race?.ended && <div className="notice">Self-timed session. Times are recorded by the teams.</div>}
      {info?.session.type === "race" && <StartingGrid sessionId={id} />}
      {entered && (
        <Box title={race?.name ?? "\u00A0"} right="Results">
          <Bd flush><EnteredResults results={entered.results} points={entered.points} /></Bd>
        </Box>
      )}
      {(!entered || finished > 0) && (
      <Box title={race?.name ?? "\u00A0"} right={rows.length ? `${finished} finished` : undefined}>
        <Bd flush>
          {rows.length === 0 ? <div className="bd note">{state ? "No runs recorded." : "Loading timing data..."}</div> : <ResultsTable rows={rows} points={points} />}
        </Bd>
      </Box>
      )}
    </>
  );
}
