import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { classify, fmtPenalty, fmtTime, type Flag, type RunStatus } from "../shared/race";
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

const STATUS: Record<RunStatus, string> = {
  queued: "Queued",
  onstage: "On stage",
  finished: "Finished",
  dnf: "DNF",
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
          <table className="r-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>Pos</th>
                <th className="is-left">Driver</th>
                <th className="is-left" style={{ width: 100 }}>Plate</th>
                <th className="is-left" style={{ width: 100 }}>Status</th>
                <th style={{ width: 110 }}>Raw</th>
                <th style={{ width: 90 }}>Pen</th>
                <th style={{ width: 110 }}>Final</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.rank ?? ""}</td>
                  <td className="is-left">{r.name}</td>
                  <td className="is-left">{r.plate}</td>
                  <td className="is-left" style={r.status === "finished" ? undefined : { color: "var(--r-text-dim)" }}>
                    {STATUS[r.status]}
                  </td>
                  <td>{r.rawMs != null ? fmtTime(r.rawMs) : ""}</td>
                  <td className={r.penaltyMs > 0 ? "is-red" : ""}>{r.penaltyMs > 0 ? fmtPenalty(r.penaltyMs) : ""}</td>
                  <td className={r.finalMs != null ? "is-green" : ""}>{r.finalMs != null ? fmtTime(r.finalMs) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
