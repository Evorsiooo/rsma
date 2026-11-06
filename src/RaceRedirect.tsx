import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { currentSession } from "../shared/sessions";
import type { RaceSummary } from "../shared/types";
import { api } from "./api";
import { NotFound } from "./NotFound";
import { Shell } from "./Shell";

/** An event link opens its current session: the one running, else the next, else the last. */
export function RaceRedirect() {
  const { id = "" } = useParams();
  const [race, setRace] = useState<RaceSummary | null | undefined>(undefined);
  useEffect(() => {
    api.race(id).then(setRace, () => setRace(null));
  }, [id]);
  if (race === null) return <NotFound />;
  if (!race) return null;
  const s = currentSession(race.sessions, Date.now());
  if (s) return <Navigate to={`/session/${s.id}`} replace />;
  return (
    <Shell>
      <div className="r-panel">
        <div className="r-header">{race.name}</div>
        <div className="r-empty">No sessions.</div>
      </div>
    </Shell>
  );
}
