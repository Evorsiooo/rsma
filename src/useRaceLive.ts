import { useEffect, useState } from "react";
import type { RaceState } from "../shared/race";

/**
 * Live race state over WebSocket with instant HTTP initial fetch and polling fallback.
 * `offset` is server time minus local time, so timers can run on server time.
 * `staff` connects to the staff feed (full state incl. audit log), `auth` to the signed-in feed
 * (the viewer's own radio and team channels); the default is the public feed.
 */
export function useRaceLive(id: string, mode: "public" | "staff" | "auth" | "radio" | boolean = "public") {
  const feed = mode === true ? "staff" : mode === false ? "public" : mode;
  const [state, setState] = useState<RaceState | null>(null);
  const [live, setLive] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let pingTimer: ReturnType<typeof setInterval>;
    let pollTimer: ReturnType<typeof setInterval>;
    let delay = 1000;
    let closed = false;

    // Immediately fetch initial state over HTTP so timing displays instantly
    const fetchState = async () => {
      try {
        const query = feed === "staff" ? "?staff=1" : feed === "auth" || feed === "radio" ? "?auth=1" : "";
        const res = await fetch(`/api/sessions/${id}/state${query}`, { cache: "no-store" });
        if (res.ok && !closed) {
          const f = (await res.json()) as { state: RaceState; now: number };
          setOffset(f.now - Date.now());
          setState(f.state);
        }
      } catch {
        // Will retry via polling or websocket
      }
    };

    fetchState();

    // Fallback polling: every 4 seconds while WebSocket is not live
    pollTimer = setInterval(() => {
      if (!closed && (!ws || ws.readyState !== WebSocket.OPEN)) {
        fetchState();
      }
    }, 4000);

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const query = feed === "staff" ? "?staff=1" : feed === "radio" ? "?auth=1&radio=1" : feed === "auth" ? "?auth=1" : "";
      try {
        ws = new WebSocket(`${proto}://${location.host}/api/sessions/${id}/ws${query}`);
      } catch {
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
        return;
      }

      ws.onopen = () => {
        delay = 1000;
        setLive(true);
      };

      ws.onmessage = (e) => {
        if (e.data === "pong") return;
        try {
          const f = JSON.parse(e.data) as { state: RaceState; now: number };
          setOffset(f.now - Date.now());
          setState(f.state);
        } catch {}
      };

      ws.onerror = () => {
        // ws.onclose will follow and trigger reconnect/fallback
      };

      ws.onclose = () => {
        setLive(false);
        if (closed) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
      };
    };

    connect();

    // Ping every 25 seconds to keep WebSocket connection alive on Cloudflare
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send("ping");
        } catch {}
      }
    }, 25000);

    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(pingTimer);
      clearInterval(pollTimer);
      ws?.close();
    };
  }, [id, feed]);

  return { state, live, offset };
}
