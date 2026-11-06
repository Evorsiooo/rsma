import { useEffect, useState } from "react";
import { api } from "./api";
import type { Me, RaceSummary } from "../shared/types";

export interface BootData {
  me: Me | null;
  races: RaceSummary[];
}

type Step = "wait" | "ok" | "fail";
export const VERSION = "v0.1.0";

export function Boot({ onReady }: { onReady: (data: BootData) => void }) {
  const [server, setServer] = useState<Step>("wait");
  const [session, setSession] = useState<Step | null>(null);
  const [events, setEvents] = useState<Step | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setServer("wait");
    setSession(null);
    setEvents(null);
    api
      .health()
      .then(async () => {
        if (!live) return;
        setServer("ok");
        setSession("wait");
        const me = await api.me();
        if (!live) return;
        setSession("ok");
        setEvents("wait");
        const races = await api.races();
        if (!live) return;
        setEvents("ok");
        onReady({ me, races });
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
  }, [attempt, onReady]);

  const failed = [server, session, events].includes("fail");
  const done = [server, session, events].filter((s) => s === "ok").length;
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
            <button className="r-btn" onClick={() => setAttempt((a) => a + 1)}>
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
