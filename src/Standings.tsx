import { useEffect, useState } from "react";
import { computeStandings, fmtPoints, fmtWindow, type Line, type Standings as Table, type StandingsData } from "../shared/standings";
import { api } from "./api";
import { Bd, Box } from "./site/parts";

const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** How an event was scored, in words. */
export function scoringText(e: { half: boolean; mode: "position" | "window"; windowMs: number | null }, defaultWindowMs: number): string {
  const how = e.mode === "window" ? `Timed windows of ${fmtWindow(e.windowMs ?? defaultWindowMs)}` : "Finishing order";
  return e.half ? `${how}, half points` : how;
}

function Cells({ line, rounds }: { line: Line; rounds: Table["rounds"] }) {
  return (
    <>
      {rounds.map((r, i) => {
        const c = line.cells[i];
        return (
          <td key={r.id} className="n" title={c ? `${r.name}: P${c.position}` : r.name}>
            {c ? fmtPoints(c.points) : <span className="mute">–</span>}
          </td>
        );
      })}
    </>
  );
}

function Grid({ lines, rounds, teams }: { lines: Line[]; rounds: Table["rounds"]; teams: boolean }) {
  return (
    <table className="t rank">
      <thead>
        <tr>
          <th className="pos">Pos</th>
          <th>{teams ? "Team" : "Driver"}</th>
          {!teams && <th>Team</th>}
          {rounds.map((r, i) => (
            <th key={r.id} className="n" title={r.name}>R{i + 1}</th>
          ))}
          <th className="n">Wins</th>
          <th className="n">Points</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={l.key}>
            <td className="pos">{i + 1}</td>
            <td><b>{l.name}</b></td>
            {!teams && <td>{l.team ?? <span className="mute">–</span>}</td>}
            <Cells line={l} rounds={rounds} />
            <td className="n">{l.wins || <span className="mute">–</span>}</td>
            <td className="n fin">{fmtPoints(l.points)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Public championship: drivers and teams, with one column per scored event. */
export function Standings() {
  const [data, setData] = useState<StandingsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"drivers" | "teams">("drivers");
  useEffect(() => {
    api.standings().then(setData, () => setFailed(true));
  }, []);
  if (failed) return <Box title="Standings"><Bd><div className="note">Could not load the standings.</div></Bd></Box>;
  if (!data) return <Box title="Standings"><Bd><div className="note">Loading...</div></Bd></Box>;
  const s = computeStandings(data.events, data.config);
  if (s.rounds.length === 0) return <Box title="Standings"><Bd><div className="note">No results yet.</div></Bd></Box>;
  const lines = view === "drivers" ? s.drivers : s.teams;
  return (
    <>
      <Box
        title={view === "drivers" ? "Drivers' championship" : "Teams' championship"}
        right={
          <>
            <button className={`btn sm${view === "drivers" ? " pri" : ""}`} onClick={() => setView("drivers")}>Drivers</button>{" "}
            <button className={`btn sm${view === "teams" ? " pri" : ""}`} onClick={() => setView("teams")}>Teams</button>
          </>
        }
      >
        <Bd flush>
          {lines.length === 0 ? <div className="note" style={{ padding: 8 }}>No teams have scored yet.</div> : <Grid lines={lines} rounds={s.rounds} teams={view === "teams"} />}
        </Bd>
      </Box>
      <Box title="Rounds">
        <Bd flush>
          <table className="t">
            <thead>
              <tr>
                <th />
                <th>Event</th>
                <th>Date</th>
                <th>Scoring</th>
              </tr>
            </thead>
            <tbody>
              {s.rounds.map((r, i) => (
                <tr key={r.id}>
                  <td className="pos">R{i + 1}</td>
                  <td><b>{r.name}</b></td>
                  <td style={{ whiteSpace: "nowrap" }}>{date.format(r.heldAt)}</td>
                  <td className="mute">{scoringText(r, data.config.windowMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bd>
      </Box>
      <Box title="Points">
        <Bd flush>
          <table className="t">
            <thead>
              <tr>
                <th>Place</th>
                {data.config.points.map((_, i) => (
                  <th key={i} className="n">{i + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Points</td>
                {data.config.points.map((p, i) => (
                  <td key={i} className="n">{fmtPoints(p)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </Bd>
      </Box>
    </>
  );
}
