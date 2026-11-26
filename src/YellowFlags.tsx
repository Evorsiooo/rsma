import { useEffect, useMemo, useState } from "react";
import type { RaceState } from "../shared/race";
import { segmentsOf, type TrackInfo } from "../shared/track";
import { api } from "./api";
import { TrackMap } from "./TrackMap";

const cache = new Map<string, Promise<TrackInfo | null>>();

/** The event's track, fetched once per version and kept; null while loading or when the event has none. */
export function useTrack(trackId: string | null): TrackInfo | null {
  const [track, setTrack] = useState<TrackInfo | null>(null);
  useEffect(() => {
    setTrack(null);
    if (!trackId) return;
    let live = true;
    if (!cache.has(trackId)) cache.set(trackId, api.track(trackId).catch(() => null));
    cache.get(trackId)!.then((t) => live && setTrack(t));
    return () => {
      live = false;
    };
  }, [trackId]);
  return track;
}

const tint = (flag: RaceState["flag"]) => (flag === "green" ? undefined : flag);
const age = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor((Math.max(0, ms) % 60000) / 1000)).padStart(2, "0")}`;

interface Common {
  track: TrackInfo;
  state: RaceState;
  /** Server time in ms. */
  now: number;
}

/** Steward panel: the map and one list of team reports and confirmed yellows. Left click confirms, right click dismisses. */
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
          onSegment={disabled ? undefined : (id, kind) => {
            if (kind === "click") {
              if (!yellow.includes(id)) send({ type: "zoneConfirm", seg: id, label: "" });
            } else if (pending.includes(id)) send({ type: "zoneDismiss", seg: id });
          }}
        />
      </div>
      <div className="r-section"><span>Yellow segments</span></div>
      <div className="r-stack" style={{ gap: 4 }}>
        {state.zoneReports.map((r) => (
          <div className="r-row" style={{ alignItems: "center", gap: 4 }} key={r.id}>
            <span className="r-text r-fill is-yellow" style={{ color: "var(--r-yellow)" }}>
              {name(r.seg)} {r.teamName}{r.car ? ` ${r.car}` : ""} {age(now - r.at)}
            </span>
            <button className="r-cell r-cell--wide" style={{ height: 19 }} disabled={disabled} onClick={() => send({ type: "zoneConfirm", seg: r.seg, label: "" })}>Confirm</button>
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

/** Team panel: the map shows confirmed yellows; a click reports a segment to the stewards. */
export function TeamYellows({ track, state, team, car, disabled, report, withdraw }: Omit<Common, "now"> & { team: string; car?: string; disabled: boolean; report: (seg: string) => void; withdraw: (id: string) => void }) {
  const segs = useMemo(() => segmentsOf(track.geometry), [track]);
  const name = (id: string) => segs.find((s) => s.id === id)?.name ?? id;
  const mine = state.zoneReports.filter((r) => r.team === team);
  return (
    <>
      <div className="r-section"><span>Track map</span></div>
      <div className="r-blank" style={{ padding: 4 }}>
        <TrackMap geometry={track.geometry} width={278} yellow={state.zones.map((z) => z.seg)} tint={tint(state.flag)} onSegment={disabled ? undefined : (id, kind) => kind === "click" && report(id)} />
      </div>
      {mine.map((r) => (
        <div className="r-row" style={{ alignItems: "center", gap: 4 }} key={r.id}>
          <span className="r-text r-fill" style={{ color: "var(--r-teal)" }}>You reported {name(r.seg)}{r.car ? ` ${r.car}` : ""}</span>
          <button className="r-cell r-cell--wide" style={{ height: 19 }} disabled={disabled} onClick={() => withdraw(r.id)}>Withdraw</button>
        </div>
      ))}
    </>
  );
}
