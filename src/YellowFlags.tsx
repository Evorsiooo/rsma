import { useMemo } from "react";
import type { RaceState } from "../shared/race";
import { segmentsOf, type TrackInfo } from "../shared/track";
import { api } from "./api";
import { TrackMap } from "./TrackMap";
import { useTrack } from "./TrackPanel";

export { useTrack };

const tint = (flag: RaceState["flag"]) => (flag === "green" ? undefined : flag);
const age = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor((Math.max(0, ms) % 60000) / 1000)).padStart(2, "0")}`;

interface Common {
  track: TrackInfo;
  state: RaceState;
  /** Server time in ms. */
  now: number;
}

/** Steward panel: the map and one list of team reports and confirmed yellows. Drag with the left button to confirm segments, with the right button to clear them. */
export function StewardYellows({ track, state, now, disabled, send }: Common & { disabled: boolean; send: (c: import("../shared/commands").Command) => Promise<boolean> }) {
  const segs = useMemo(() => segmentsOf(track.geometry), [track]);
  const name = (id: string) => segs.find((s) => s.id === id)?.name ?? id;
  const yellow = state.zones.map((z) => z.seg);
  const pending = [...new Set(state.zoneReports.map((r) => r.seg))];
  return (
    <>
      <div className="r-section"><span>Track map</span></div>
      <div className="r-blank" style={{ padding: 4 }}>
        <TrackMap
          geometry={track.geometry}
          width={278}
          yellow={yellow}
          pending={pending}
          tint={tint(state.flag)}
          onSegments={disabled ? undefined : async (ids, kind) => {
            // Left button confirms every segment crossed; right button clears the yellow ones and dismisses the reports on the rest.
            for (const id of ids) {
              if (kind === "click") {
                if (!yellow.includes(id)) await send({ type: "zoneConfirm", seg: id, label: "" });
              } else if (yellow.includes(id)) await send({ type: "zoneClear", seg: id, label: "" });
              else if (pending.includes(id)) await send({ type: "zoneDismiss", seg: id });
            }
          }}
        />
      </div>
      <div className="r-section"><span>Yellow segments</span></div>
      <div className="r-stack" style={{ gap: 4 }}>
        {state.zoneReports.map((r) => (
          <div className="r-row" style={{ alignItems: "center", gap: 4 }} key={r.id}>
            <span className="r-text r-fill is-yellow" style={{ color: "var(--r-yellow)" }}>
              {name(r.seg)}{r.kind === "clear" ? " clear" : ""} {r.teamName}{r.car ? ` ${r.car}` : ""} {age(now - r.at)}
            </span>
            <button className="r-cell r-cell--wide" style={{ height: 19 }} disabled={disabled} onClick={() => send({ type: r.kind === "clear" ? "zoneClear" : "zoneConfirm", seg: r.seg, label: "" })}>Confirm</button>
            <button className="r-cell r-cell--wide" style={{ height: 19 }} disabled={disabled} onClick={() => send({ type: "zoneDismiss", seg: r.seg })}>Dismiss</button>
          </div>
        ))}
        {state.zones.map((z) => (
          <div className="r-row" style={{ alignItems: "center", gap: 4 }} key={z.seg}>
            <span className="r-text r-fill">{name(z.seg)} yellow {age(now - z.at)}</span>
            <button className="r-cell r-cell--wide" style={{ height: 19 }} disabled={disabled} onClick={() => send({ type: "zoneClear", seg: z.seg, label: "" })}>Clear</button>
          </div>
        ))}
        <button className="r-btn" disabled={disabled || state.zones.length === 0} onClick={() => send({ type: "zoneClearAll" })}>Clear all yellows</button>
      </div>
    </>
  );
}

/** Team panel: the map shows confirmed yellows and the team's own reports. Dragging with the left button reports segments; with the right button it withdraws the team's reports and reports confirmed yellows as clear. */
export function TeamYellows({ track, state, team, disabled, report, withdraw }: Omit<Common, "now"> & { team: string; car?: string; disabled: boolean; report: (seg: string, clear?: boolean) => void; withdraw: (id: string) => void }) {
  const segs = useMemo(() => segmentsOf(track.geometry), [track]);
  const name = (id: string) => segs.find((s) => s.id === id)?.name ?? id;
  const mine = state.zoneReports.filter((r) => r.team === team);
  const yellow = state.zones.map((z) => z.seg);
  return (
    <>
      <div className="r-section"><span>Track map</span></div>
      <div className="r-blank" style={{ padding: 4 }}>
        <TrackMap
          geometry={track.geometry}
          width={278}
          yellow={yellow}
          pending={mine.map((r) => r.seg)}
          tint={tint(state.flag)}
          onSegments={disabled ? undefined : (ids, kind) => {
            for (const id of ids) {
              const own = mine.find((r) => r.seg === id);
              if (kind === "click") {
                if (!own && !yellow.includes(id)) report(id);
              } else if (own && own.kind !== "clear") withdraw(own.id);
              else if (yellow.includes(id) && !own) report(id, true);
              else if (own) withdraw(own.id);
            }
          }}
        />
      </div>
      {mine.map((r) => (
        <div className="r-row" style={{ alignItems: "center", gap: 4 }} key={r.id}>
          <span className="r-text r-fill" style={{ color: "var(--r-teal)" }}>You reported {name(r.seg)}{r.kind === "clear" ? " clear" : ""}{r.car ? ` ${r.car}` : ""}</span>
          <button className="r-cell r-cell--wide" style={{ height: 19 }} disabled={disabled} onClick={() => withdraw(r.id)}>Withdraw</button>
        </div>
      ))}
    </>
  );
}
