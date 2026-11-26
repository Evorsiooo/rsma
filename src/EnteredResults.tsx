import { driversOf, fmtPoints, fmtSpan, offsetsOf, type ResultRow } from "../shared/standings";
import { fmtTime } from "../shared/race";

/** Results typed in for a session or event: a car with the drivers who drove it, or a driver. Points are the row's; a car's are split between its drivers. */
export function EnteredResults({ results, points }: { results: ResultRow[]; points: number[] | null }) {
  const rows = [...results].sort((a, b) => a.position - b.position);
  const cars = rows.some((r) => r.car);
  const teams = rows.some((r) => r.teamName);
  const times = rows.some((r) => r.timeMs != null);
  const offsets = offsetsOf(rows);
  return (
    <table className={points ? "t rank" : "t"}>
      <thead>
        <tr>
          <th className="pos">Pos</th>
          {cars && <th>Car</th>}
          <th>{cars ? "Drivers" : "Driver"}</th>
          {teams && <th>Team</th>}
          {times && <th className="n">Time</th>}
          {offsets && <th className="n">Gap</th>}
          {points && <th className="n">Points</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const who = driversOf(r);
          return (
            <tr key={r.position}>
              <td className="pos">{r.position}</td>
              {cars && <td><b>{r.car ?? ""}</b></td>}
              <td>{cars ? who.join(", ") : <b>{r.username}</b>}</td>
              {teams && <td>{r.teamName ?? <span className="mute">–</span>}</td>}
              {times && <td className="n">{r.timeMs != null ? fmtTime(r.timeMs) : "–"}</td>}
              {offsets && <td className="n">{i === 0 ? "–" : `+${fmtSpan(offsets[i])}`}</td>}
              {points && (
                <td className="n fin">
                  {fmtPoints(points[i])}
                  {who.length > 1 && points[i] > 0 && <span className="mute"> ({fmtPoints(Math.round((points[i] / who.length) * 100) / 100)} each)</span>}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
