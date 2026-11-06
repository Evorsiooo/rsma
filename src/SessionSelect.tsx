import { useNavigate } from "react-router-dom";
import type { SessionSummary } from "../shared/types";

/** Switch between the sessions of an event, staying on the same kind of page (`suffix` such as "/steward"). */
export function SessionSelect({ sessions, current, suffix = "", width = 200 }: { sessions: SessionSummary[]; current: string; suffix?: string; width?: number }) {
  const nav = useNavigate();
  if (sessions.length < 2) return null;
  return (
    <div className="r-select" style={{ width, flex: "none" }}>
      <select aria-label="Session" value={current} onChange={(e) => nav(`/session/${e.target.value}${suffix}`)}>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}
