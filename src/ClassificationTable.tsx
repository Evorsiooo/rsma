import type { ReactNode } from "react";
import { fmtPenalty, fmtTime, type Row, type RunStatus } from "../shared/race";

const STATUS: Record<RunStatus, string> = {
  queued: "Queued",
  onstage: "On stage",
  finished: "Finished",
  dnf: "DNF",
};

/** Classification: finished runs ranked, then on stage, queued, DNF. `action` adds a trailing column. */
export function ClassificationTable({ rows, action, mine }: { rows: Row[]; action?: (r: Row) => ReactNode; mine?: (r: Row) => boolean }) {
  const teams = rows.some((r) => r.teamName);
  const cars = rows.some((r) => r.car);
  const best = Math.min(...rows.map((r) => r.finalMs ?? Infinity));
  return (
    <table className="r-table">
      <thead>
        <tr>
          <th style={{ width: 40 }}>Pos</th>
          <th className="is-left">Driver</th>
          <th className="is-left" style={{ width: 80 }}>Plate</th>
          {teams && <th className="is-left" style={{ width: 120 }}>Team</th>}
          {cars && <th className="is-left" style={{ width: 120 }}>Car</th>}
          <th className="is-left" style={{ width: 90 }}>Status</th>
          <th style={{ width: 90 }}>Raw</th>
          <th style={{ width: 70 }}>Pen</th>
          <th style={{ width: 90 }}>Final</th>
          {action && <th style={{ width: 100 }} />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={mine?.(r) ? "is-selected" : ""}>
            <td style={{ color: "var(--r-teal)" }}>{r.rank ?? ""}</td>
            <td className="is-left">{r.name}</td>
            <td className="is-left" style={{ color: "var(--r-red)" }}>{r.plate}</td>
            {teams && <td className="is-left" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.teamName ?? ""}</td>}
            {cars && <td className="is-left" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.car ?? ""}</td>}
            <td className="is-left" style={r.status === "finished" ? undefined : { color: "var(--r-text-dim)" }}>
              {STATUS[r.status]}
            </td>
            <td style={{ color: "var(--r-yellow)" }}>{r.rawMs != null ? fmtTime(r.rawMs) : ""}</td>
            <td className={r.penaltyMs > 0 ? "is-red" : ""}>{r.penaltyMs > 0 ? fmtPenalty(r.penaltyMs) : ""}</td>
            <td style={r.finalMs != null ? { color: r.finalMs === best ? "var(--r-magenta)" : "var(--r-green)" } : undefined}>{r.finalMs != null ? fmtTime(r.finalMs) : ""}</td>
            {action && <td>{action(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
