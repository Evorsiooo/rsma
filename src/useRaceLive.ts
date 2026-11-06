import { useEffect, useState } from "react";
import type { RaceState } from "../shared/race";

/**
 * Live race state over WebSocket; reconnects with a short backoff.
 * `offset` is server time minus local time, so timers can run on server time.
 * `staff` connects to the staff feed (full state incl. audit log), `auth` to the signed-in feed
 * (the viewer's own radio and team channels); the default is the public feed.
 */
export function useRaceLive(id: string, mode: "public" | "staff" | "auth" | boolean = "public") {
  const feed = mode === true ? "staff" : mode === false ? "public" : mode;
  const [state, setState] = useState<RaceState | null>(null);
  const [live, setLive] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1000;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/races/${id}/ws${feed === "staff" ? "?staff=1" : feed === "auth" ? "?auth=1" : ""}`);
      ws.onopen = () => {
        delay = 1000;
        setLive(true);
      };
      ws.onmessage = (e) => {
        const f = JSON.parse(e.data) as { state: RaceState; now: number };
        setOffset(f.now - Date.now());
        setState(f.state);
      };
      ws.onclose = () => {
        setLive(false);
        if (closed) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [id, feed]);

  return { state, live, offset };
}
