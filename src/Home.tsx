import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RaceSummary } from "../shared/types";
import { useMe } from "./me";
import { api } from "./api";
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
  const [authError] = useState(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("auth_error");
    const detail = params.get("detail");
    if (code) history.replaceState(null, "", "/");
    if (!code) return null;
    const base = AUTH_ERRORS[code] ?? "Sign-in failed.";
    return detail ? `${base} (${detail})` : base;
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
      <div className="r-row" style={{ flexWrap: "wrap" }}>
        <button className="r-btn" style={{ width: 200 }} onClick={() => nav("/team-registration")}>
          Team registration
        </button>
        <button className="r-btn" style={{ width: 240 }} onClick={() => nav("/driver-registration")}>
          Driver registration
        </button>
        <button className="r-btn" style={{ width: 220 }} onClick={() => nav("/work-at-rsma")}>
          Work at the RSMA
        </button>
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
