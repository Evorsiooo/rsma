import { useEffect, useState } from "react";
import { api } from "./api";
import type { RaceSummary } from "../shared/types";

type Step = "wait" | "ok" | "fail";
const VERSION = "v0.1.0";

export function Boot({ onReady }: { onReady: (races: RaceSummary[]) => void }) {
  const [server, setServer] = useState<Step>("wait");
  const [events, setEvents] = useState<Step | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setServer("wait");
    setEvents(null);
    api
      .health()
      .then(() => {
        if (!live) return;
        setServer("ok");
        setEvents("wait");
        return api.races().then((races) => {
          if (!live) return;
          setEvents("ok");
          onReady(races);
        });
      })
      .catch(() => {
        if (!live) return;
        setServer((s) => (s === "wait" ? "fail" : s));
        setEvents((e) => (e === "wait" ? "fail" : e));
      });
    return () => {
      live = false;
    };
  }, [attempt, onReady]);

  const failed = server === "fail" || events === "fail";
  const done = [server, events].filter((s) => s === "ok").length;
  const line = (s: Step | null, text: string) =>
    s && <div className={`r-log__line is-${s}`}>{text}</div>;

  return (
    <div className="r-screen">
      <div className="r-boot">
        <div className="r-plate">FLAGMAN</div>
        <div className="r-log r-boot__lines">
          {line(server, "Connecting to server")}
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
          <div className="r-progress" style={{ ["--value" as string]: done / 2 }} />
        )}
        <div className="r-boot__foot r-text r-text--dim">
          <span>{failed ? "Offline" : "Please wait"}</span>
          <span>{VERSION}</span>
        </div>
      </div>
    </div>
  );
}
