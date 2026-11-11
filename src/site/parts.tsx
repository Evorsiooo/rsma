import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Flag, Row } from "../../shared/race";
import { fmtPenalty, fmtTime } from "../../shared/race";
import { useBootSteps, type BootData } from "../Boot";

/** Module box: slanted blue title on a pale rule. `right` is small text or buttons at the end of the title bar. */
export function Box({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`box${className ? ` ${className}` : ""}`}>
      <div className="bh">
        <h3>{title}</h3>
        {right != null && <span className="r">{right}</span>}
      </div>
      {children}
    </div>
  );
}

/** Box body. `flush` for tables (scrolls sideways on narrow screens), `top` adds a dotted rule above. */
export function Bd({ flush, top, bar, style, children }: { flush?: boolean; top?: boolean; bar?: boolean; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <div className={`bd${flush ? " flush" : ""}${top ? " top" : ""}${bar ? " bar" : ""}`} style={style}>
      {children}
    </div>
  );
}

/** Lines of the loading box. */
const STEP_TEXT = { wait: "...", ok: "OK", fail: "Failed" } as const;

/** The website's loading box, shown while the first data loads. */
export function SiteBoot({ onReady }: { onReady: (d: BootData) => void }) {
  const { server, session, events, failed, done, retry } = useBootSteps(onReady);
  const line = (s: "wait" | "ok" | "fail" | null, text: string) =>
    s && (
      <div className={s === "fail" ? "fail" : undefined}>
        {STEP_TEXT[s]} {text}
      </div>
    );
  return (
    <div className="boot">
      <Box title="Loading">
        <div className="bd">
          <div className="bootlines">
            {line(server, "Connecting to server")}
            {line(session, "Checking session")}
            {line(events, "Loading events")}
          </div>
          {failed ? (
            <div className="bar">
              <span className="err" style={{ flex: 1 }}>Could not reach the server.</span>
              <button className="btn pri" onClick={retry}>Retry</button>
            </div>
          ) : (
            <div className="prog"><i style={{ ["--v" as string]: `${Math.max(8, (done / 3) * 100)}%` }} /></div>
          )}
        </div>
      </Box>
    </div>
  );
}

/** Not-found box for website pages. */
export function SiteNotFound() {
  return (
    <Box title="Not Found">
      <Bd>
        <div className="note">
          There is nothing at this address. <Link to="/">Return home</Link>.
        </div>
      </Bd>
    </Box>
  );
}

const FLAG_CLASS: Record<Flag, string> = { green: "", yellow: " y", red: " r" };
export const FLAG_LABEL: Record<Flag, string> = { green: "Green flag", yellow: "Yellow flag", red: "Red flag" };

/** Track-condition bar of the live timing page. */
export function FlagBar({ flag, ended, live }: { flag?: Flag; ended?: boolean; live: boolean }) {
  if (ended)
    return (
      <div className="flag end">
        <span className="k">Track condition</span>
        <span className="v">Race ended</span>
      </div>
    );
  return (
    <div className={`flag${flag ? FLAG_CLASS[flag] : ""}`} style={flag ? undefined : { visibility: "hidden" }}>
      <span className="k">Track condition</span>
      <span className="v">{flag ? FLAG_LABEL[flag] : " "}</span>
      <span className="l">{live ? "● LIVE" : "○ OFFLINE"}</span>
    </div>
  );
}

const STATUS: Record<Row["status"], { text: string; cls: string }> = {
  queued: { text: "Queued", cls: "que" },
  onstage: { text: "On stage", cls: "run" },
  finished: { text: "Finished", cls: "fin" },
  dnf: { text: "DNF", cls: "dnf" },
};

/** Classification table of the live timing page: finished runs ranked, then on stage, queued, DNF. */
export function ResultsTable({ rows, mine }: { rows: Row[]; mine?: (r: Row) => boolean }) {
  const teams = rows.some((r) => r.teamName);
  const cars = rows.some((r) => r.car);
  const best = Math.min(...rows.filter((r) => r.status === "finished" && r.rawMs != null).map((r) => r.rawMs!));
  return (
    <table className="t">
      <thead>
        <tr>
          <th className="pos">Pos</th>
          <th>Driver</th>
          <th>Plate</th>
          {teams && <th>Team</th>}
          {cars && <th>Car</th>}
          <th>Status</th>
          <th className="n">Raw time</th>
          <th className="n">Penalties</th>
          <th className="n">Final time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={mine?.(r) ? "mine" : undefined}>
            <td className="pos">{r.rank ?? "–"}</td>
            <td>
              {r.number && <span className="num">{r.number}</span>}
              {r.name}
              {r.status === "finished" && r.rawMs === best && <span className="fr" title="Fastest raw time">FR</span>}
            </td>
            <td>{r.plate}</td>
            {teams && <td>{r.teamName ?? ""}</td>}
            {cars && <td>{r.car ?? ""}</td>}
            <td><span className={`st ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span></td>
            <td className="n">{r.rawMs != null ? fmtTime(r.rawMs) : "–"}</td>
            <td className="n">{r.penaltyMs > 0 ? <span className="pen">{fmtPenalty(r.penaltyMs)}</span> : "–"}</td>
            <td className="n fin">{r.finalMs != null ? fmtTime(r.finalMs) : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
