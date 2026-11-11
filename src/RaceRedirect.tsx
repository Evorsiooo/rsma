import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { currentSession } from "../shared/sessions";
import type { RaceSummary } from "../shared/types";
import { api } from "./api";
import { NotFound } from "./NotFound";
import { Bd, Box } from "./site/parts";

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
    <Box title={race.name}>
      <Bd><div className="note">No sessions.</div></Bd>
    </Box>
  );
}
