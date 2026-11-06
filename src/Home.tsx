import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { currentSession } from "../shared/sessions";
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
                  <td style={{ width: 130 + (me?.teams.length ? 130 : 0), padding: 2 }}>
                    <div className="r-row">
                      <button className="r-btn r-fill" style={{ width: "100%", height: 24, paddingTop: 2 }} onClick={() => nav(`/race/${r.id}`)}>
                        Timing
                      </button>
                      {me?.teams.length ? (
                        <button className="r-btn r-fill" style={{ width: "100%", height: 24, paddingTop: 2 }} onClick={() => {
                          const cur = currentSession(r.sessions, Date.now());
                          if (cur) nav(`/session/${cur.id}/team/${me.teams[0].id}`);
                        }}>
                          Team
                        </button>
                      ) : null}
                    </div>
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
        {me?.memberships.length ? (
          <button className="r-btn" style={{ width: 200 }} onClick={() => nav("/my-team")}>
            My Team
          </button>
        ) : null}
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
