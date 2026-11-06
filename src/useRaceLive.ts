import { useEffect, useState } from "react";
import type { RaceState } from "../shared/race";

/** Live race state over WebSocket; reconnects with a short backoff. */
export function useRaceLive(id: string) {
  const [state, setState] = useState<RaceState | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1000;
    let closed = false;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/races/${id}/ws`);
      ws.onopen = () => {
        delay = 1000;
        setLive(true);
      };
      ws.onmessage = (e) => setState(JSON.parse(e.data) as RaceState);
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
  }, [id]);

  return { state, live };
}
