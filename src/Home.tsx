import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { RaceSummary } from "../shared/types";
import { api } from "./api";
import { useBootData } from "./Layouts";
import { Bd, Box } from "./site/parts";

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

function EventRows({ races, label, primary, until }: { races: RaceSummary[]; label: string; primary?: boolean; until?: boolean }) {
  return (
    <table className="t">
      <tbody>
        {races.map((r) => (
          <tr key={r.id}>
            <td><b>{r.name}</b></td>
            <td style={{ width: 230 }}>{until ? "Until " : ""}{fmt.format(r.expiresAt)}</td>
            <td className="n"><Link className={`btn sm${primary ? " pri" : ""}`} to={`/race/${r.id}`}>{label}</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Home() {
  const races = useBootData()?.races ?? [];
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
    <>
      {authError && <div className="err">{authError}</div>}
      <Box title="Events">
        <Bd flush>{races.length === 0 ? <div className="bd note">No active events.</div> : <EventRows races={races} label="Timing" primary until />}</Bd>
      </Box>
      {past.length > 0 && (
        <Box title="Past Events">
          <Bd flush><EventRows races={past} label="Results" /></Bd>
        </Box>
      )}
    </>
  );
}
