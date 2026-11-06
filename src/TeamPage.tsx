import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { classify, type Flag } from "../shared/race";
import type { RaceSummary } from "../shared/types";
import { api, sendTeamRadio } from "./api";
import { ClassificationTable } from "./ClassificationTable";
import { useMe } from "./me";
import { NotFound } from "./NotFound";
import { Topbar, VERSION } from "./Shell";
import { fmtLive, toast, useNow } from "./ui";
import { useRaceLive } from "./useRaceLive";

const FLAG: Record<Flag, { label: string; tone: string }> = {
  green: { label: "Green flag", tone: " is-green" },
  yellow: { label: "Yellow flag", tone: "" },
  red: { label: "Red flag", tone: " is-red" },
};

const mmss = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB");

/** Team panel: all cars' live timing, the team's release window and the team radio channel. */
export function TeamPage() {
  const { id = "", teamId = "" } = useParams();
  const { me } = useMe();
  const team = me?.teams.find((t) => t.id === teamId);
  const [race, setRace] = useState<RaceSummary | null | undefined>(undefined);
  const { state, live, offset } = useRaceLive(id, team ? "auth" : "public");
  const now = useNow(offset, !!team);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.race(id).then(setRace, () => setRace(null));
  }, [id]);
  const messages = (state?.radio ?? []).filter((m) => m.to === "team" && m.team === teamId);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length]);

  if (race === null) return <NotFound />;
  if (!me)
    return (
      <div className="r-window r-stack" style={{ minHeight: "100%", padding: 4, boxSizing: "border-box" }}>
        <div className="r-panel">
          <div className="r-header">Team panel</div>
          <div className="r-stack" style={{ padding: 4, background: "var(--r-chrome)" }}>
            <button className="r-btn" onClick={() => location.assign(`/api/auth/roblox/login?next=${encodeURIComponent(location.pathname)}`)}>
              Sign in with Roblox
            </button>
          </div>
        </div>
      </div>
    );
  if (!team) return <NotFound />;

  const rows = state ? classify(state.runs) : [];
  const queued = state?.runs.filter((r) => r.status === "queued") ?? [];
  const mine = rows.filter((r) => r.team === teamId && (r.status === "queued" || r.status === "onstage"));
  const releaseAt = (runId: string) => {
    if (!state?.lastReleaseAt) return null;
    const k = queued.findIndex((r) => r.id === runId);
    return k < 0 ? null : state.lastReleaseAt + (k + 1) * state.cadenceSec * 1000;
  };
  const transmit = async () => {
    const t = text.trim();
    if (!t) return;
    const err = await sendTeamRadio(id, teamId, t);
    if (err) toast("Message not sent.");
    else setText("");
  };

  return (
    <div className="page">
      <Topbar>
        <span className="r-text" style={{ marginLeft: 12 }}>{team.name}</span>
        {race && <span className="r-text" style={{ marginLeft: 12, color: "var(--r-text-dim)" }}>{race.name}</span>}
      </Topbar>
      <div className="page__body">
        <div className="page__col page__col--wide">
          <div className="r-row" style={{ alignItems: "center" }}>
            <div className={`r-banner r-fill${state ? FLAG[state.flag].tone : ""}`} style={{ visibility: state ? "visible" : "hidden" }}>
              {state ? FLAG[state.flag].label : " "}
            </div>
            {live ? <div className="r-lamp r-lamp--fixed">LIVE</div> : <div className="r-lamp r-lamp--fixed r-lamp--red is-blink">OFF</div>}
          </div>

          <div className="r-panel">
            <div className="r-header">Release window</div>
            {mine.length === 0 ? (
              <div className="r-empty">No queued or running cars.</div>
            ) : (
              <table className="r-table">
                <thead>
                  <tr>
                    <th className="is-left">Driver</th>
                    <th className="is-left" style={{ width: 100 }}>Plate</th>
                    <th className="is-left" style={{ width: 100 }}>Status</th>
                    <th style={{ width: 120 }}>Release in</th>
                    <th style={{ width: 110 }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((r) => {
                    const at = r.status === "queued" ? releaseAt(r.id) : null;
                    return (
                      <tr key={r.id}>
                        <td className="is-left">{r.name}</td>
                        <td className="is-left" style={{ color: "var(--r-red)" }}>{r.plate}</td>
                        <td className="is-left" style={{ color: r.status === "onstage" ? "var(--r-yellow)" : "var(--r-text-dim)" }}>
                          {r.status === "onstage" ? "On stage" : `Queued, #${queued.findIndex((q) => q.id === r.id) + 1}`}
                        </td>
                        <td style={{ color: "var(--r-green)" }}>{at == null ? "" : at <= now ? "Due" : mmss(at - now)}</td>
                        <td style={{ color: "var(--r-yellow)" }}>
                          {r.status === "onstage" && r.startedAt != null && r.startedAt <= now ? fmtLive(now - r.startedAt) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="r-panel">
            <div className="r-header">Live timing</div>
            {rows.length === 0 ? <div className="r-empty">No runs recorded.</div> : <ClassificationTable rows={rows} mine={(r) => r.team === teamId} />}
          </div>

          <div className="r-panel" style={{ display: "flex", flexDirection: "column" }}>
            <div className="r-header">Team radio</div>
            <div className="r-log r-log--wrap" ref={log} style={{ height: 160, flex: "none" }}>
              {messages.map((m) => (
                <div className="r-log__line" key={m.id}>{hhmm(m.at)} {m.from}: {m.text}</div>
              ))}
            </div>
            <div className="r-row" style={{ padding: 4 }}>
              <input className="r-field r-fill" aria-label="Team message" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && transmit()} />
              <button className="r-btn" style={{ width: 120 }} disabled={!text.trim()} onClick={transmit}>Send</button>
            </div>
          </div>
        </div>
      </div>
      <div className="r-statusbar">
        <span className="r-statusbar__end">{VERSION}</span>
      </div>
    </div>
  );
}
