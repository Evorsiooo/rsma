import { useState } from "react";
import { carText, fmtPenalty, fmtTime, foldCars, type Row } from "../shared/race";
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
  /** Adds a Mode column with this text per car. */
  modeLabel?: (r: Row) => string;
  /** Usernames of active driver radio listeners. */
  onRadio?: string[];
}

/** Timing table shared by the steward and team panels. */
export function TimingTable({ rows: all, now, selId, onSelect, bestFinal, mine, modeLabel, onRadio }: Props) {
  // Endurance: the car comes first (team and car), then the person driving it.
  const endurance = all.some((r) => r.entry);
  // The other drivers' times of a car are folded under the car's row until its tag is pressed.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const { rows, hidden } = foldCars(all, open);
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  return (
    <table className="r-table">
      <thead>
        <tr>
          <th className="is-left" style={{ width: 28 }}>P</th>
          <th className="is-left" style={{ width: 36 }}>No</th>
          {endurance ? (
            <>
              <th className="is-left" style={{ width: 180 }}>Car</th>
              <th className="is-left">Driving</th>
              <th className="is-left" style={{ width: 80 }}>Plate</th>
            </>
          ) : (
            <>
              <th className="is-left" style={{ width: 170 }}>Driver</th>
              <th className="is-left" style={{ width: 100 }}>Plate</th>
              <th className="is-left">Team</th>
              <th className="is-left">Car</th>
            </>
          )}
          <th className="is-left" style={{ width: 80 }}>Status</th>
          {modeLabel && <th className="is-left" style={{ width: 120 }}>Mode</th>}
          <th style={{ width: 90 }}>Time</th>
          <th style={{ width: 70 }}>Pen</th>
          <th style={{ width: 90 }}>Final</th>
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
            <td className="is-left">{r.number ?? ""}</td>
            {endurance ? (
              <>
                <td className="is-left" style={{ overflow: "hidden", textOverflow: "ellipsis", ...(mine?.(r) ? { color: "var(--r-teal)" } : undefined) }}>{carText(r)}
                  {r.entry && hidden.has(r.entry) && r.rank != null && (
                    <button
                      className={`r-tag${open.has(r.entry) ? " is-green" : ""}`}
                      style={{ marginLeft: 6, cursor: "pointer" }}
                      aria-expanded={open.has(r.entry)}
                      title="Show the times of the car's other drivers"
                      onClick={(e) => { e.stopPropagation(); toggle(r.entry!); }}
                    >
                      {open.has(r.entry) ? "Hide" : "+"} {hidden.get(r.entry)} {hidden.get(r.entry) === 1 ? "driver" : "drivers"}
                    </button>
                  )}
                </td>
                <td className="is-left" style={mine?.(r) ? { color: "var(--r-teal)" } : undefined}>
                  {r.name}
                  {onRadio && (!mine || mine(r)) && (
                    <span
                      className={`r-tag${onRadio.includes(r.name.toLowerCase()) ? " is-green" : ""}`}
                      style={{ marginLeft: 6 }}
                      title={onRadio.includes(r.name.toLowerCase()) ? "Driver is on the radio" : "Driver is not on the radio"}
                    >
                      RD
                    </span>
                  )}
                </td>
                <td className="is-left" style={{ color: "var(--r-red)" }}>{r.plate}</td>
              </>
            ) : (
              <>
                <td className="is-left" style={mine?.(r) ? { color: "var(--r-teal)" } : undefined}>
                  {r.name}
                  {onRadio && (!mine || mine(r)) && (
                    <span
                      className={`r-tag${onRadio.includes(r.name.toLowerCase()) ? " is-green" : ""}`}
                      style={{ marginLeft: 6 }}
                      title={onRadio.includes(r.name.toLowerCase()) ? "Driver is on the radio" : "Driver is not on the radio"}
                    >
                      RD
                    </span>
                  )}
                </td>
                <td className="is-left" style={{ color: "var(--r-red)" }}>{r.plate}</td>
                <td className="is-left" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.teamName ?? ""}</td>
                <td className="is-left" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.car ?? ""}</td>
              </>
            )}
            <td className="is-left" style={{ color: STATUS_COLOR[r.status] }}>{STATUS_TEXT[r.status]}</td>
            {modeLabel && <td className="is-left" style={{ color: "var(--r-text-dim)" }}>{modeLabel(r)}</td>}
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
