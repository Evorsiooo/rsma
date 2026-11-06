import { fmtPenalty, fmtTime, type Row } from "../shared/race";
import { fmtLive } from "./ui";

const STATUS_TEXT = { queued: "Queued", onstage: "On stage", finished: "Finished", dnf: "DNF" } as const;
const STATUS_COLOR = {
  queued: "var(--r-text-dim)",
  onstage: "var(--r-yellow)",
  finished: "var(--r-green)",
  dnf: "var(--r-red)",
} as const;

interface Props {
  rows: Row[];
  now: number;
  selId?: string | null;
  onSelect?: (id: string) => void;
  bestFinal?: number;
  /** Rows to pick out in teal, such as a team's own cars. */
  mine?: (r: Row) => boolean;
}

/** Timing table shared by the steward and team panels. */
export function TimingTable({ rows, now, selId, onSelect, bestFinal, mine }: Props) {
  return (
    <table className="r-table">
      <thead>
        <tr>
          <th className="is-left" style={{ width: 36 }}>P</th>
          <th className="is-left">Driver</th>
          <th className="is-left" style={{ width: 90 }}>Plate</th>
          <th className="is-left" style={{ width: 130 }}>Team</th>
          <th className="is-left" style={{ width: 90 }}>Status</th>
          <th style={{ width: 100 }}>Time</th>
          <th style={{ width: 90 }}>Pen</th>
          <th style={{ width: 100 }}>Final</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            className={r.id === selId ? "is-selected" : ""}
            style={onSelect ? { cursor: "pointer" } : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-selected={onSelect ? r.id === selId : undefined}
            onClick={onSelect && (() => onSelect(r.id))}
            onKeyDown={onSelect && ((e) => (e.key === "Enter" || e.key === " ") && onSelect(r.id))}
          >
            <td className="is-left" style={{ color: "var(--r-teal)" }}>{r.rank ?? ""}</td>
            <td className="is-left" style={mine?.(r) ? { color: "var(--r-teal)" } : undefined}>{r.name}</td>
            <td className="is-left" style={{ color: "var(--r-red)" }}>{r.plate}</td>
            <td className="is-left" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.teamName ?? ""}</td>
            <td className="is-left" style={{ color: STATUS_COLOR[r.status] }}>{STATUS_TEXT[r.status]}</td>
            <td style={{ color: "var(--r-yellow)" }}>
              {r.status === "onstage" ? (r.startedAt! > now ? "" : fmtLive(now - r.startedAt!)) : r.rawMs != null ? fmtTime(r.rawMs) : ""}
            </td>
            <td className={r.penaltyMs ? "is-red" : ""}>{r.penaltyMs ? fmtPenalty(r.penaltyMs) : ""}</td>
            <td style={{ color: r.finalMs != null ? (r.finalMs === bestFinal ? "var(--r-magenta)" : "var(--r-green)") : undefined }}>
              {r.finalMs != null ? fmtTime(r.finalMs) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
