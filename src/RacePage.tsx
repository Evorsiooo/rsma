import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { classify, type Flag } from "../shared/race";
import { ClassificationTable } from "./ClassificationTable";
import type { RaceSummary } from "../shared/types";
import { api } from "./api";
import { NotFound } from "./NotFound";
import { Shell } from "./Shell";
import { useRaceLive } from "./useRaceLive";

const FLAG: Record<Flag, { label: string; tone: string }> = {
  green: { label: "Green flag", tone: " is-green" },
  yellow: { label: "Yellow flag", tone: "" },
  red: { label: "Red flag", tone: " is-red" },
};

export function RacePage() {
  const { id = "" } = useParams();
  const [race, setRace] = useState<RaceSummary | null | undefined>(undefined);
  const { state, live } = useRaceLive(id);

  useEffect(() => {
    setRace(undefined);
    api.race(id).then(setRace, () => setRace(null));
  }, [id]);

  if (race === null) return <NotFound />;
  const rows = state ? classify(state.runs) : [];

  return (
    <Shell>
      <div className="r-row" style={{ alignItems: "center" }}>
        <div className={`r-banner r-fill${state ? FLAG[state.flag].tone : ""}`} style={{ visibility: state ? "visible" : "hidden" }}>
          {state ? FLAG[state.flag].label : " "}
        </div>
        {live ? (
          <div className="r-lamp r-lamp--fixed">LIVE</div>
        ) : (
          <div className="r-lamp r-lamp--fixed r-lamp--red is-blink">OFF</div>
        )}
      </div>
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
