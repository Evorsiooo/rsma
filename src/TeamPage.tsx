import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { classify, fmtPenalty, type Flag, type RadioMsg } from "../shared/race";
import { fmtClock } from "../shared/sessions";
import type { SessionInfo } from "../shared/types";
import { addPitWindow, api, removePitWindow, sendTeamRadio, teamTiming } from "./api";
import { Lcd } from "./Lcd";
import { useMe } from "./me";
import { NotFound } from "./NotFound";
import { SessionSelect } from "./SessionSelect";
import { Topbar } from "./Shell";
import { TimingTable } from "./TimingTable";
import { sessionCountdown, toast, useClock, useNow } from "./ui";
import { useRaceLive } from "./useRaceLive";

const FLAG_WORD: Record<Flag, string> = { green: "GREEN", yellow: "YELLOW", red: "RED" };
const ERRORS: Record<string, string> = {
  race_ended: "This race has ended.",
  invalid: "Invalid window.",
  too_many: "Too many windows.",
  not_found: "Not found.",
  no_queue: "No queued car in your team.",
  not_running: "No car of your team is running.",
  not_self_timed: "This session is timed by the stewards.",
  forbidden: "You are not in this team.",
  unauthorized: "Sign in again.",
};
const mmss = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB");

function SessionClockLcd({ session, offset }: { session: SessionInfo["session"]; offset: number }) {
  const now = useClock(offset);
  const cd = sessionCountdown(session, now);
  return (
    <>
      <div className="r-header">{cd.phase === "upcoming" ? "Session starts" : "Session ends"}</div>
      <div className="r-module__well">
        <Lcd value={cd.phase === "ended" ? "--:--" : cd.value} h={36} label="Time to session end" />
      </div>
    </>
  );
}

/** Team panel: the steward panel's layout for one team, with all cars' timing, the team radio and pit windows. */
export function TeamPage() {
  const { id = "", teamId = "" } = useParams();
  const { me } = useMe();
  const team = me?.teams.find((t) => t.id === teamId);
  const [info, setInfo] = useState<SessionInfo | null | undefined>(undefined);

  useEffect(() => {
    api.session(id).then(setInfo, () => setInfo(null));
  }, [id]);

  if (info === null) return <NotFound />;
  if (!me)
    return (
      <div className="r-screen">
        <div className="r-dialog">
          <div className="r-header">Sign in</div>
          <div className="r-dialog__foot">
            <button className="r-btn r-btn--advance r-fill" onClick={() => location.assign(`/api/auth/roblox/login?next=${encodeURIComponent(location.pathname)}`)}>
              <span>Sign in with Roblox</span>
            </button>
          </div>
        </div>
      </div>
    );
  if (!team) return <NotFound />;
  if (!info) return <div className="r-screen" />;
  return <Panel sessionId={id} info={info} team={team} />;
}

function Panel({ sessionId, info, team }: { sessionId: string; info: SessionInfo; team: { id: string; name: string } }) {
  const { race, session } = info;
  const nav = useNavigate();
  const { state, live, offset } = useRaceLive(sessionId, "auth");
  const now = useNow(offset, true);
  const [selId, setSelId] = useState<string | null>(null);
  const [sort, setSort] = useState<"fastest" | "last">("fastest");
  const [text, setText] = useState("");
  const [toStewards, setToStewards] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const lengthMs = session.endsAt - session.startsAt;
  const step = lengthMs > 2 * 3600_000 ? 5 : 1; // minutes
  const stepMs = step * 60_000;
  const [from, setFrom] = useState(stepMs * 5);
  const [to, setTo] = useState(stepMs * 10);
  const fromMs = Math.min(from, Math.max(0, lengthMs - stepMs));
  const toMs = Math.min(Math.max(to, fromMs + stepMs), lengthMs);

  const radio = state?.radio ?? [];
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [radio.length]);

  const rows = useMemo(() => {
    if (!state) return [];
    const ranked = classify(state.runs);
    if (sort === "fastest") return ranked;
    const started = ranked.filter((r) => r.startedAt != null).sort((a, b) => b.startedAt! - a.startedAt!);
    return [...started, ...ranked.filter((r) => r.startedAt == null)];
  }, [state, sort]);
  if (!state) return <div className="r-screen" />;

  const queued = state.runs.filter((r) => r.status === "queued");
  const onTrack = state.runs.filter((r) => r.status === "onstage");
  const sel = selId ? state.runs.find((r) => r.id === selId) : undefined;
  const bestFinal = rows.reduce<number | undefined>((m, r) => (r.finalMs != null && (m == null || r.finalMs < m) ? r.finalMs : m), undefined);
  const counting = onTrack.filter((r) => r.startedAt! > now);
  const nextMine = queued.findIndex((r) => r.team === team.id);
  const nextCar = nextMine < 0 ? undefined : queued[nextMine];
  const releaseAt = nextMine < 0 || !state.lastReleaseAt ? null : state.lastReleaseAt + (nextMine + 1) * state.cadenceSec * 1000;
  const mineOnTrack = onTrack.filter((r) => r.team === team.id).length;
  const mineQueued = queued.filter((r) => r.team === team.id).length;
  const windows = state.pitWindows.filter((w) => w.team === team.id);
  const elapsed = now - session.startsAt;
  // Graduation under the timeline: about five labelled marks, on round minutes.
  const tickStep = [5, 10, 15, 30, 60, 120, 180, 360].find((m) => lengthMs / (m * 60_000) <= 5) ?? 720;
  const ticks = Array.from({ length: Math.floor(lengthMs / (tickStep * 60_000)) + 1 }, (_, k) => k * tickStep * 60_000);
  const pct = (ms: number) => `${(Math.min(Math.max(ms, 0), lengthMs) / lengthMs) * 100}%`;

  const line = (m: RadioMsg) => {
    const tone = m.tone ?? (m.to === "stewards" ? "teal" : undefined);
    const who = m.to === "stewards" ? `${m.from} to stewards` : m.to === "team" ? `${m.from} to team` : m.from;
    return (
      <div className={`r-log__line${tone ? ` is-${tone}` : ""}`} key={m.id}>
        {hhmm(m.at)} {who}: {m.text}
      </div>
    );
  };
  const transmit = async () => {
    const t = text.trim();
    if (!t) return;
    const err = await sendTeamRadio(sessionId, team.id, t, toStewards ? "stewards" : "team");
    if (err) toast(ERRORS[err] ?? "Message not sent.");
    else setText("");
  };
  const addWindow = async () => {
    const err = await addPitWindow(sessionId, team.id, fromMs, toMs);
    if (err) toast(ERRORS[err] ?? "Window not added.");
  };
  const timing = async (action: "go" | "finish") => {
    const err = await teamTiming(sessionId, team.id, action);
    if (err) toast(ERRORS[err] ?? "Command failed.");
  };
  const delWindow = async (wid: string) => {
    const err = await removePitWindow(sessionId, team.id, wid);
    if (err) toast(ERRORS[err] ?? "Window not removed.");
  };

  return (
    <div className="page">
      <Topbar>
        <span className="r-text">{team.name}</span>
        <span className="r-text r-text--dim">{race.name}</span>
        <SessionSelect sessions={race.sessions} current={session.id} suffix={`/team/${team.id}`} width={180} />
        <button className="r-btn" onClick={() => nav(`/session/${sessionId}`)}>Timing</button>
      </Topbar>
      <div className="r-stack" style={{ flex: "1 1 0", minHeight: 0, padding: 4, gap: 4 }}>
        {race.ended && <div className="r-banner is-red" style={{ flex: "none" }}>Race ended.</div>}
        <div className="r-row" style={{ height: 90, flex: "none" }}>
          <div className="r-module" style={{ width: 84 }}>
            <div className="r-header">Link</div>
            <div className="r-module__well r-module__well--bare">
              {live ? <div className="r-lamp r-lamp--fixed">LIVE</div> : <div className="r-lamp r-lamp--fixed r-lamp--red is-blink">OFF</div>}
            </div>
          </div>
          <div className="r-module" style={{ width: 150 }}>
            <SessionClockLcd session={session} offset={offset} />
          </div>
          <div className="r-module" style={{ width: 170 }}>
            <div className="r-header">Next release</div>
            <div className="r-module__well">
              <Lcd value={releaseAt == null ? "--:--" : mmss(Math.max(0, releaseAt - now))} h={36} label="Time to team's next release" />
            </div>
          </div>
          <div className="r-module" style={{ width: 76 }}>
            <div className="r-header">On track</div>
            <div className="r-module__well"><Lcd value={String(mineOnTrack)} h={32} ghost={1} label="Team cars on track" /></div>
          </div>
          <div className="r-module" style={{ width: 76 }}>
            <div className="r-header">Queued</div>
            <div className="r-module__well"><Lcd value={String(mineQueued)} h={32} ghost={1} label="Team cars queued" /></div>
          </div>
        </div>

        <div className="r-row" style={{ height: 42, flex: "none" }}>
          {session.selfTimed && (
            <button className="r-btn r-btn--advance" style={{ width: 112 }} disabled={!nextCar || race.ended} onClick={() => timing("go")}>
              <span>Go</span>
            </button>
          )}
          <div className={`r-plate is-${state.flag}`} style={{ width: 120 }}>{FLAG_WORD[state.flag]}</div>
          <div className="r-plate r-fill">
            {counting.length > 0 ? Math.ceil((counting[0].startedAt! - now) / 1000) : session.selfTimed && nextCar ? `${nextCar.name}  ${nextCar.plate}` : ""}
          </div>
          {session.selfTimed && (
            <button className="r-btn r-btn--advance" style={{ width: 150 }} disabled={race.ended} onClick={() => timing("finish")}>
              <span>Stop timer</span>
            </button>
          )}
        </div>

        <div className="r-row" style={{ flex: "1 1 0", minHeight: 0 }}>
          <div className="r-stack" style={{ width: 300, padding: "0 6px", flex: "none", overflow: "auto" }}>
            <div className="r-section"><span>Pit window, min</span></div>
            <div className="r-timeline" aria-label="Pit windows">
              {windows.map((w) => (
                <div className="r-timeline__window" key={w.id} style={{ ["--from" as string]: pct(w.fromMs), ["--len" as string]: pct(w.toMs - w.fromMs) }} />
              ))}
              {elapsed >= 0 && elapsed <= lengthMs && <div className="r-timeline__now" style={{ ["--at" as string]: pct(elapsed) }} />}
            </div>
            <div className="r-scale" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} className="r-scale__tick" style={{ left: pct(t) }}>
                  {t / 60_000}
                </span>
              ))}
            </div>
            <div className="r-row" style={{ alignItems: "center" }}>
              <span className="r-text" style={{ width: 90 }}>Opens at</span>
              <div className="r-stepper r-fill">
                <button className="r-cell" aria-label="Opens earlier" disabled={fromMs <= 0} onClick={() => setFrom(Math.max(0, fromMs - stepMs))}>-</button>
                <div className="r-readout r-fill">{fmtClock(fromMs)}</div>
                <button className="r-cell" aria-label="Opens later" disabled={fromMs + stepMs >= lengthMs} onClick={() => { setFrom(fromMs + stepMs); if (toMs <= fromMs + stepMs) setTo(fromMs + 2 * stepMs); }}>+</button>
              </div>
            </div>
            <div className="r-row" style={{ alignItems: "center" }}>
              <span className="r-text" style={{ width: 90 }}>Closes at</span>
              <div className="r-stepper r-fill">
                <button className="r-cell" aria-label="Closes earlier" disabled={toMs - stepMs <= fromMs} onClick={() => setTo(toMs - stepMs)}>-</button>
                <div className="r-readout r-fill">{fmtClock(toMs)}</div>
                <button className="r-cell" aria-label="Closes later" disabled={toMs + stepMs > lengthMs} onClick={() => setTo(toMs + stepMs)}>+</button>
              </div>
            </div>
            <button className="r-btn" disabled={race.ended || toMs <= fromMs} onClick={addWindow}>Add window</button>
            {windows.length > 0 && (
              <div className="r-stack" style={{ gap: 2 }}>
                {windows.map((w) => (
                  <div className="r-row" style={{ alignItems: "center", gap: 4 }} key={w.id}>
                    <span className="r-text r-fill" style={{ color: "var(--r-yellow)" }}>{fmtClock(w.fromMs)} to {fmtClock(w.toMs)}</span>
                    <button className="r-cell r-cell--wide r-cell--red" style={{ height: 19 }} disabled={race.ended} onClick={() => delWindow(w.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="r-section"><span>Sort</span></div>
            <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
              <button className="r-btn" aria-pressed={sort === "fastest"} onClick={() => setSort("fastest")}>Fastest</button>
              <button className="r-btn" aria-pressed={sort === "last"} onClick={() => setSort("last")}>Last run</button>
            </div>
          </div>

          <div className="r-stack r-fill">
            <div className="r-panel r-fill" style={{ overflow: "auto" }}>
              <TimingTable rows={rows} now={now} selId={selId} onSelect={setSelId} bestFinal={bestFinal} mine={(r) => r.team === team.id} />
            </div>

            <div className="r-row" style={{ height: 200, flex: "none" }}>
              <div className="r-panel r-fill">
                <div className="r-header">Race log</div>
                <div className="r-log r-log--wrap" ref={logRef} style={{ flex: "1 1 0", minHeight: 0 }}>
                  {radio.map(line)}
                </div>
                <div className="r-header">Team message</div>
                <input className="r-field" style={{ width: "100%" }} aria-label="Team message" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && transmit()} />
                <div className="r-grid" style={{ ["--cols" as string]: 3 }}>
                  <button className={`r-cell${!toStewards ? " is-on" : ""}`} aria-pressed={!toStewards} onClick={() => setToStewards(false)}>Team</button>
                  <button className={`r-cell${toStewards ? " is-on" : ""}`} aria-pressed={toStewards} onClick={() => setToStewards(true)}>Stewards</button>
                  <button className="r-cell" disabled={!text.trim() || race.ended} onClick={transmit}>Transmit</button>
                </div>
              </div>

              <div className="r-panel" style={{ width: 220 }}>
                <div className="r-header">Selected car</div>
                <div className="r-log r-log--title">{sel ? `${sel.name}  ${sel.plate}` : ""}</div>
                <div className="r-log" style={{ flex: "1 1 0", minHeight: 0 }}>
                  {sel?.penalties.map((p, i) => (
                    <div className="r-log__line is-red" key={i}>{fmtPenalty(p.ms)} {p.name}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
