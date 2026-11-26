import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { TrackInfo } from "../shared/track";
import { api } from "./api";
import { TrackMap, type TrackMapProps } from "./TrackMap";

// A track's drawing never changes while a page is open, so each id is fetched once.
const cache = new Map<string, Promise<TrackInfo | null>>();

/** The saved track an event runs on (null while loading, when none is picked, or when it cannot be loaded). */
export function useTrack(trackId: string | null | undefined): TrackInfo | null {
  const [track, setTrack] = useState<TrackInfo | null>(null);
  useEffect(() => {
    setTrack(null);
    if (!trackId) return;
    let live = true;
    let p = cache.get(trackId);
    if (!p) {
      p = api.track(trackId).catch(() => null);
      cache.set(trackId, p);
      void p.then((t) => t || cache.delete(trackId));
    }
    void p.then((t) => live && setTrack(t));
    return () => {
      live = false;
    };
  }, [trackId]);
  return track;
}

type Overlay = Pick<TrackMapProps, "yellow" | "pending" | "tint" | "onSegment" | "labels">;

/**
 * The track map section of a dark Flagman panel: a "Track map" caption and the drawing in a black well.
 * Nothing renders when the event has no track. `below` is where the yellow flag controls of a later change go.
 */
export function PanelTrackMap({ trackId, width = 286, below, ...overlay }: { trackId: string | null | undefined; width?: number; below?: ReactNode } & Overlay) {
  const track = useTrack(trackId);
  if (!track) return null;
  return (
    <>
      <div className="r-section"><span>Track map</span></div>
      <div className="r-blank" style={{ padding: "4px 0", flex: "none" }}>
        <TrackMap geometry={track.geometry} width={width} theme="dark" {...overlay} />
      </div>
      {below}
    </>
  );
}

/** The driver pop-out's read-only map, a panel of its own between the driver panel and the radio list. */
export function DriverTrackMap({ trackId, width = 316 }: { trackId: string | null | undefined; width?: number }) {
  const track = useTrack(trackId);
  if (!track) return null;
  return (
    <div className="r-panel" style={{ flex: "none" }}>
      <div className="r-header">Track</div>
      <div style={{ padding: "4px 0" }}>
        <TrackMap geometry={track.geometry} width={width} theme="dark" />
      </div>
    </div>
  );
}
