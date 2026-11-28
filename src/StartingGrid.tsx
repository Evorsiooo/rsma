import { useEffect, useState } from "react";
import { fmtTime } from "../shared/race";
import type { GridView } from "../worker/grid";
import { Bd, Box } from "./site/parts";

/** The starting grid of a race: the qualifying session's times, one place per car, a car using its fastest driver who is racing. */
export function StartingGrid({ sessionId, refresh }: { sessionId: string; refresh?: number }) {
  const [g, setG] = useState<GridView | null>(null);
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/grid`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<GridView>) : null)).then(setG, () => setG(null));
  }, [sessionId, refresh]);
  if (!g?.from) return null;
  const cars = g.rows.some((r) => r.entry);
  return (
    <Box title="Starting grid" right={g.from.name}>
      <Bd flush>
        {g.rows.length === 0 ? (
          <div className="bd note">No qualifying times yet.</div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th className="pos">Pos</th>
                <th>{cars ? "Car" : "Driver"}</th>
                {cars && <th>Driver</th>}
                <th className="n">Time</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.entry ?? r.driver}>
                  <td className="pos">{r.pit ? "Pit" : r.position}</td>
                  <td>
                    {r.number && <span className="num">{r.number}</span>}
                    {cars ? r.car : r.driver}
                  </td>
                  {cars && <td>{r.driver}</td>}
                  <td className="n fin">{r.pit ? "Pit lane" : fmtTime(r.ms)}</td>
                  <td>{r.pit ? <span className="mute">{r.noTime ? "No qualifying time" : "Registered after qualifying"}</span> : r.skipped.length > 0 ? <span className="mute">Time of {r.driver}; {r.skipped.join(", ")} not racing</span> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Bd>
    </Box>
  );
}
