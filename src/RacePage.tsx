import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { classify } from "../shared/race";
import type { SessionInfo } from "../shared/types";
import { api } from "./api";
import { NotFound } from "./NotFound";
import { Bd, Box, FlagBar, ResultsTable } from "./site/parts";
import { SessionSelect } from "./SessionSelect";
import { sessionCountdown, useClock } from "./ui";
import { useRaceLive } from "./useRaceLive";

export function RacePage() {
  const { id = "" } = useParams();
  const [info, setInfo] = useState<SessionInfo | null | undefined>(undefined);
  const { state, live, offset } = useRaceLive(id);
  const now = useClock(offset);

  useEffect(() => {
    setInfo(undefined);
    api.session(id).then(setInfo, () => setInfo(null));
  }, [id]);

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
          {!race?.ended && (
            <button
              className="btn"
              onClick={() => window.open(`/session/${id}/driver`, `flagman-radio-${id}`, "popup,width=340,height=640")}
            >
              Radio
            </button>
          )}
        </div>
      )}
      <FlagBar flag={state?.flag} ended={race?.ended} live={live} />
      {info?.session.type === "race" && !race?.ended && <div className="notice">Live timing is not available for races.</div>}
      {info?.session.selfTimed && !race?.ended && <div className="notice">Self-timed session. Times are recorded by the teams.</div>}
      <Box title={race?.name ?? "\u00A0"} right={rows.length ? `${finished} finished` : undefined}>
        <Bd flush>
          {rows.length === 0 ? <div className="bd note">{state ? "No runs recorded." : "Loading timing data..."}</div> : <ResultsTable rows={rows} />}
        </Bd>
      </Box>
    </>
  );
}
