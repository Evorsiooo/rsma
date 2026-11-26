import { useEffect, useState } from "react";
import type { TrackInfo } from "../shared/track";
import { api } from "./api";
import { TrackMap } from "./TrackMap";

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
