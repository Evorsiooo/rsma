import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Me, RaceSummary } from "../shared/types";

export interface BootData {
  me: Me | null;
  races: RaceSummary[];
}

type Step = "wait" | "ok" | "fail";
export const VERSION = "v0.1.0";

/** The start-up checks shared by the Flagman loading screen and the website's loading box. `minMs` keeps the screen up long enough to read. */
export function useBootSteps(onReady: (data: BootData) => void, minMs = 0) {
  const [server, setServer] = useState<Step>("wait");
  const [session, setSession] = useState<Step | null>(null);
  const [events, setEvents] = useState<Step | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    let live = true;
    const t0 = Date.now();
    setServer("wait");
    setSession(null);
    setEvents(null);
    // The three checks do not depend on each other, so they go out together; each line turns green as its answer arrives.
    setSession("wait");
    setEvents("wait");
    const step = <T,>(p: Promise<T>, set: (s: Step) => void) =>
      p.then((v) => {
        if (live) set("ok");
        return v;
      });
    Promise.all([step(api.health(), setServer), step(api.me(), setSession), step(api.races(), setEvents)])
      .then(async ([, me, races]) => {
        if (!live) return;
        const rest = minMs - (Date.now() - t0);
        if (rest > 0) await new Promise((r) => setTimeout(r, rest));
        if (!live) return;
        ready.current({ me, races });
      })
      .catch(() => {
        if (!live) return;
        setServer((s) => (s === "wait" ? "fail" : s));
        setSession((s) => (s === "wait" ? "fail" : s));
        setEvents((s) => (s === "wait" ? "fail" : s));
      });
    return () => {
      live = false;
    };
  }, [attempt, minMs]);

  const failed = [server, session, events].includes("fail");
  const done = [server, session, events].filter((s) => s === "ok").length;
  return { server, session, events, failed, done, retry: () => setAttempt((a) => a + 1) };
}

/** Flagman loading screen. */
export function Boot({ onReady, minMs }: { onReady: (data: BootData) => void; minMs?: number }) {
  const { server, session, events, failed, done, retry } = useBootSteps(onReady, minMs);
  const line = (s: Step | null, text: string) =>
    s && <div className={`r-log__line is-${s}`}>{text}</div>;

  return (
    <div className="r-screen">
      <div className="r-boot">
        <div className="r-plate">FLAGMAN</div>
        <div className="r-log r-boot__lines">
          {line(server, "Connecting to server")}
          {line(session, "Checking session")}
          {line(events, "Loading events")}
        </div>
        {failed ? (
          <div className="r-banner is-red">
            Could not reach the server.
            <button className="r-btn" onClick={retry}>
              Retry
            </button>
          </div>
        ) : (
          <div className="r-progress" style={{ ["--value" as string]: done / 3 }} />
        )}
        <div className="r-boot__foot r-text r-text--dim">
          <span />
          <span>{VERSION}</span>
        </div>
      </div>
    </div>
  );
}
