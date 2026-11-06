import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { classify, type Flag } from "../shared/race";
import { ClassificationTable } from "./ClassificationTable";
import type { SessionInfo } from "../shared/types";
import { api } from "./api";
import { NotFound } from "./NotFound";
import { Shell } from "./Shell";
import { SessionSelect } from "./SessionSelect";
import { sessionCountdown, useClock } from "./ui";
import { useRaceLive } from "./useRaceLive";

const FLAG: Record<Flag, { label: string; tone: string }> = {
  green: { label: "Green flag", tone: " is-green" },
  yellow: { label: "Yellow flag", tone: "" },
  red: { label: "Red flag", tone: " is-red" },
};

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

  return (
    <Shell>
      <div className="r-row" style={{ alignItems: "center" }}>
        {race?.ended ? (
          <div className="r-banner r-fill">Race ended</div>
        ) : (
          <div className={`r-banner r-fill${state ? FLAG[state.flag].tone : ""}`} style={{ visibility: state ? "visible" : "hidden" }}>
            {state ? FLAG[state.flag].label : " "}
          </div>
        )}
        {cd && !race?.ended && (
          <div className="r-banner" style={{ width: 190, flex: "none" }}>
            {cd.phase === "ended" ? "Session ended" : `${cd.label} ${cd.value}`}
          </div>
        )}
        {info && <SessionSelect sessions={info.race.sessions} current={info.session.id} bar />}
        {!race?.ended && <button
          className="r-btn"
          onClick={() => window.open(`/session/${id}/driver`, `flagman-radio-${id}`, "popup,width=340,height=640")}
        >
          Radio
        </button>}
        {race?.ended ? null : live ? (
          <div className="r-lamp r-lamp--fixed">LIVE</div>
        ) : (
          <div className="r-lamp r-lamp--fixed r-lamp--red is-blink">OFF</div>
        )}
      </div>
      {info?.session.selfTimed && !race?.ended && <div className="r-banner is-teal">Self-timed session. Times are recorded by the teams.</div>}
      <div className="r-panel">
        <div className="r-header">{race?.name ?? " "}</div>
        {rows.length === 0 ? (
          <div className="r-empty">{state ? "No runs recorded." : ""}</div>
        ) : (
          <ClassificationTable rows={rows} />
        )}
      </div>
    </Shell>
  );
}
