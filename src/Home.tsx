import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RaceSummary } from "../shared/types";
import { useMe } from "./me";
import { api, registrationApi } from "./api";
import { regStatus, upcomingSessions } from "./regUi";
import { Shell } from "./Shell";

const AUTH_ERRORS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  state: "Sign-in expired. Try again.",
  token: "Roblox rejected the sign-in.",
  profile: "Could not read your Roblox profile.",
};

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function Home({ races }: { races: RaceSummary[] }) {
  const nav = useNavigate();
  const { me } = useMe();
  const [past, setPast] = useState<RaceSummary[]>([]);
  useEffect(() => {
    api.pastRaces().then(setPast, () => {});
  }, []);
  const [regs, setRegs] = useState<Awaited<ReturnType<typeof registrationApi.list>>>([]);
  const [pick, setPick] = useState("");
  useEffect(() => {
    registrationApi.list().then(setRegs, () => {});
  }, []);
  const now = Date.now();
  const regSessions = upcomingSessions(races, regs, now).filter((u) => u.reg && regStatus(u.reg, now).phase !== "closed");
  const multiRace = new Set(regSessions.map((u) => u.race.id)).size > 1;
  const chosen = regSessions.find((u) => u.session.id === pick) ?? regSessions[0];
  const chosenStatus = chosen?.reg ? regStatus(chosen.reg, now) : null;
  const [authError] = useState(() => {
    const code = new URLSearchParams(location.search).get("auth_error");
    if (code) history.replaceState(null, "", "/");
    return code ? (AUTH_ERRORS[code] ?? "Sign-in failed.") : null;
  });
  return (
    <Shell>
      {authError && <div className="r-banner is-red">{authError}</div>}
      <div className="r-panel">
        <div className="r-header">Events</div>
        {races.length === 0 ? (
          <div className="r-empty">No active events.</div>
        ) : (
          <table className="r-table">
            <tbody>
              {races.map((r) => (
                <tr key={r.id}>
                  <td className="is-left">{r.name}</td>
                  <td style={{ width: 240, color: "var(--r-text-dim)" }}>
                    Until {fmt.format(r.expiresAt)}
                  </td>
                  <td style={{ width: 130, padding: 2 }}>
                    <button className="r-btn r-fill" style={{ width: "100%", height: 24, paddingTop: 2 }} onClick={() => nav(`/race/${r.id}`)}>
                      Timing
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="r-row">
        <button className="r-btn" style={{ width: 200 }} onClick={() => nav("/team-registration")}>
          Team registration
        </button>
        {chosen && chosenStatus && (
          <>
            <div className="r-select r-fill">
              <select aria-label="Session to register for" value={chosen.session.id} onChange={(e) => setPick(e.target.value)}>
                {regSessions.map((u) => (
                  <option key={u.session.id} value={u.session.id}>
                    {multiRace ? `${u.race.name} · ` : ""}{u.session.name} · {regStatus(u.reg!, now).text}
                  </option>
                ))}
              </select>
            </div>
            <button className="r-btn" style={{ width: 120 }} disabled={chosenStatus.phase !== "open"} onClick={() => nav(`/session/${chosen.session.id}/register`)}>
              Register
            </button>
          </>
        )}
      </div>
      {past.length > 0 && (
        <div className="r-panel">
          <div className="r-header">Past events</div>
          <table className="r-table">
            <tbody>
              {past.map((r) => (
                <tr key={r.id}>
                  <td className="is-left">{r.name}</td>
                  <td style={{ width: 240, color: "var(--r-text-dim)" }}>{fmt.format(r.expiresAt)}</td>
                  <td style={{ width: 130, padding: 2 }}>
                    <button className="r-btn r-fill" style={{ width: "100%", height: 24, paddingTop: 2 }} onClick={() => nav(`/race/${r.id}`)}>
                      Results
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
