import type { RaceSummary } from "../shared/types";
import { Shell } from "./Shell";

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function Home({ races }: { races: RaceSummary[] }) {
  return (
    <Shell>
      <div className="r-module">
        <div className="r-header">Race control</div>
        <div className="r-module__well" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className="r-plate" style={{ height: 56, fontSize: 32, letterSpacing: ".2em" }}>
            FLAGMAN
          </div>
          <div className="r-text r-text--dim" style={{ textAlign: "center" }}>
            Timing, stewarding and radio for rally and time-trial events.
          </div>
        </div>
      </div>
      <div className="r-panel">
        <div className="r-header">Active events</div>
        {races.length === 0 ? (
          <div className="r-empty">No active events.</div>
        ) : (
          <table className="r-table">
            <tbody>
              {races.map((r) => (
                <tr key={r.id}>
                  <td className="is-left">{r.name}</td>
                  <td style={{ width: 200, color: "var(--r-text-dim)" }}>
                    Until {fmt.format(r.expiresAt)}
                  </td>
                  <td style={{ width: 130, padding: 2 }}>
                    {/* Enabled with the public stage view. */}
                    <button className="r-btn r-fill" style={{ width: "100%", height: 24, paddingTop: 2 }} disabled>
                      Timing
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
