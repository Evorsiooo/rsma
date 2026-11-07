import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startSignIn } from "./access";
import { useParams } from "react-router-dom";
import { classify, fmtPenalty, fmtTime, type Flag, type Run } from "../shared/race";
import type { SessionInfo } from "../shared/types";
import { answerAsk, api, driverRadio } from "./api";
import { enableAudio, setVolume, speak, startBeeps } from "./audio";
import { NotFound } from "./NotFound";
import { useMe } from "./me";
import { Dialog, sessionCountdown, toast, useClock } from "./ui";
import { useRaceLive } from "./useRaceLive";

const FLAG: Record<Flag, { label: string; tone: string }> = {
  green: { label: "Green flag", tone: " is-green" },
  yellow: { label: "Yellow flag", tone: "" },
  red: { label: "Red flag", tone: " is-red" },
};

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`flagman.driver.${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`flagman.driver.${k}`, v);
    } catch {
      /* private mode: settings just do not persist */
    }
  },
};

/** A driver can have several runs; pick the one that matters now: on stage, else queued, else the latest. */
function pickRun(runs: Run[], name: string): Run | undefined {
  const mine = runs.filter((r) => r.name.toLowerCase() === name.toLowerCase());
  return mine.find((r) => r.status === "onstage") ?? mine.find((r) => r.status === "queued") ?? mine[mine.length - 1];
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB");

/** Driver radio pop-out: flag, own status, spoken steward messages, start beeps and result announcements. */
export function DriverPage() {
  const { id = "" } = useParams();
  const [info, setInfo] = useState<SessionInfo | null | undefined>(undefined);
  const { me: user } = useMe();
  const { state, live, offset } = useRaceLive(id, user ? "auth" : "public");
  const clock = useClock(offset);
  const [audioOn, setAudioOn] = useState(false);
  const name = user?.username ?? "";
  const [vol, setVol] = useState(() => Number(store.get("vol") ?? 100));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState(() => store.get("voice") ?? "");
  const [rx, setRx] = useState(false);
  const [settings, setSettings] = useState(false);
  const [chat, setChat] = useState("");

  useEffect(() => {
    api.session(id).then(setInfo, () => setInfo(null));
  }, [id]);
  useEffect(() => {
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  useEffect(() => setVolume(vol / 100), [vol]);

  const me: Run | undefined = state ? pickRun(state.runs, name) : undefined;
  const say = useCallback(
    (text: string) => {
      setRx(true);
      speak(text, voiceURI, () => setRx(false));
    },
    [voiceURI],
  );

  // React to new state: start beeps, radio messages, results. The first state only seeds what was already seen.
  const seen = useRef<{ radio: Set<string>; beeped: Set<string> } | null>(null);
  useEffect(() => {
    if (!state) return;
    if (!seen.current) {
      seen.current = {
        radio: new Set(state.radio.map((m) => m.id)),
        beeped: new Set(state.runs.filter((r) => r.startedAt != null).map((r) => r.id)),
      };
      return;
    }
    const s = seen.current;
    if (audioOn) {
      for (const r of state.runs) {
        if (r.startedAt == null || s.beeped.has(r.id)) continue;
        s.beeped.add(r.id);
        if (me && r.id !== me.id) continue; // with a driver picked, only their own start is beeped
        const goIn = (r.startedAt - offset - Date.now()) / 1000;
        if (goIn > 0) startBeeps(goIn);
      }
      for (const m of state.radio) {
        if (s.radio.has(m.id)) continue;
        s.radio.add(m.id);
        say(m.say ?? m.text); // the server only sends this viewer what is addressed to them
      }
    }
    for (const m of state.radio) s.radio.add(m.id);
  }, [state, audioOn, me, offset, say]);

  const messages = useMemo(() => (state?.radio ?? []).slice(-50), [state]);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length]);

  if (info === null) return <NotFound />;
  if (!user)
    return (
      <div className="r-window r-stack" style={{ minHeight: "100%", padding: 4, boxSizing: "border-box" }}>
        <div className="r-panel">
          <div className="r-header">Driver radio</div>
          <div className="r-stack" style={{ padding: 4, background: "var(--r-chrome)" }}>
            <button className="r-btn" onClick={() => startSignIn()}>
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  const hasTeam = !!state?.runs.some((r) => r.team && r.name.toLowerCase() === name.toLowerCase());
  const questions = messages.filter((m) => m.ask && !m.ask.answered);
  const sendChat = async () => {
    const t = chat.trim();
    if (!t) return;
    const err = await driverRadio(id, t);
    if (err) toast(err === "no_team" ? "Messages need a team." : "Message not sent.");
    else setChat("");
  };
  const queuePos = me?.status === "queued" ? state!.runs.filter((r) => r.status === "queued").indexOf(me) + 1 : 0;
  const myRank = me?.status === "finished" ? classify(state!.runs).find((r) => r.id === me.id)?.rank : undefined;
  const status = me ? { queued: `Queued, #${queuePos}`, onstage: "On stage", finished: `Finished, P${myRank}`, dnf: "DNF" }[me.status] : "";

  return (
    <div className="r-window r-stack" style={{ minHeight: "100%", padding: 4, gap: 4, boxSizing: "border-box" }}>
      <div className="r-row" style={{ alignItems: "center" }}>
        <div className={`r-banner r-fill${state ? FLAG[state.flag].tone : ""}`} style={{ visibility: state ? "visible" : "hidden" }}>
          {state ? FLAG[state.flag].label : " "}
        </div>
        {live ? <div className="r-lamp r-lamp--fixed">LIVE</div> : <div className="r-lamp r-lamp--fixed r-lamp--red is-blink">OFF</div>}
        <div className={`r-lamp r-lamp--fixed${rx ? "" : " is-off"}`}>RX</div>
        <button className="r-btn r-btn--icon" aria-label="Settings" title="Settings" style={{ width: 30, padding: 0 }} onClick={() => setSettings(true)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" style={{ display: "block", margin: "auto" }}>
            <path d="M6 0h4v2h2v1h1v2h2v4h-2v1h-1v2h-2v1h-2v2H6v-2H4v-1H3v-2H1V5h2V4h1V2h2zM8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" fillRule="evenodd" />
          </svg>
        </button>
      </div>

      {info && !info.race.ended && (
        <div className="r-banner">
          {(() => {
            const cd = sessionCountdown(info.session, clock);
            return `${info.session.name}: ${cd.phase === "ended" ? "ended" : `${cd.label.toLowerCase()} ${cd.value}`}`;
          })()}
        </div>
      )}

      {!audioOn && (
        <div className="r-banner">
          <span>Audio is off.</span>
          <button
            className="r-cell r-cell--wide"
            onClick={async () => {
              if (await enableAudio()) setAudioOn(true);
            }}
          >
            Enable
          </button>
        </div>
      )}

      <div className="r-panel">
        <div className="r-header">{user.username}</div>
        {me ? (
          <table className="r-table">
            <tbody>
              <tr><td className="is-left">Status</td><td>{status}</td></tr>
              <tr><td className="is-left">Plate</td><td>{me.plate}</td></tr>
              {me.teamName && <tr><td className="is-left">Team</td><td>{me.teamName}</td></tr>}
              {me.status === "finished" && me.rawMs != null && (
                <>
                  <tr><td className="is-left">Time</td><td style={{ color: "var(--r-yellow)" }}>{fmtTime(me.rawMs)}</td></tr>
                  {me.penaltyMs > 0 && <tr><td className="is-left">Penalties</td><td className="is-red">{fmtPenalty(me.penaltyMs)}</td></tr>}
                  <tr><td className="is-left">Final</td><td className="is-green">{fmtTime(me.rawMs + me.penaltyMs)}</td></tr>
                </>
              )}
            </tbody>
          </table>
        ) : (
          <div className="r-empty">No run staged for {user.username}.</div>
        )}
      </div>

      {questions.map((m) => (
        <div className="r-panel" key={m.id}>
          <div className="r-header">{m.teamName ? `Question, ${m.teamName}` : "Question"}</div>
          <div className="r-stack" style={{ padding: 4, background: "var(--r-chrome)" }}>
            <div className="r-text">{m.text}</div>
            <div className="r-grid" style={{ ["--cols" as string]: m.ask!.yesNo ? 2 : 1 }}>
              {m.ask!.options.map((o, i) => (
                <button
                  key={i}
                  className={`r-btn r-btn--answer${m.ask!.yesNo ? (i === 0 ? " is-yes" : " is-no") : ""}`}
                  onClick={async () => {
                    const err = await answerAsk(id, m.id, i);
                    if (err) toast(err === "answered" ? "Already answered." : "Answer not sent.");
                  }}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}

      <div className="r-panel r-fill" style={{ display: "flex", flexDirection: "column", minHeight: 120 }}>
        <div className="r-header">Radio</div>
        <div className="r-log r-log--wrap r-fill" ref={transcript}>
          {messages.map((m) => (
            <div className={`r-log__line${m.tone ? ` is-${m.tone}` : ""}`} key={m.id}>{hhmm(m.at)} {m.text}</div>
          ))}
        </div>
        {hasTeam && (
          <div className="r-row" style={{ padding: 4 }}>
            <input className="r-field r-fill" aria-label="Message to team" maxLength={200} value={chat} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} />
            <button className="r-btn" style={{ width: 90 }} disabled={!chat.trim()} onClick={sendChat}>Send</button>
          </div>
        )}
      </div>

      {settings && (
        <Dialog title="Audio" size="s" onClose={() => setSettings(false)} foot={<button className="r-btn" onClick={() => setSettings(false)}>Close</button>}>
        <div className="r-stack">
          <div className="r-form-field">
            <span className="r-label">Volume {vol}%</span>
            <input
              className="r-slider"
              type="range"
              min={0}
              max={100}
              value={vol}
              aria-label="Volume"
              onChange={(e) => {
                setVol(Number(e.target.value));
                store.set("vol", e.target.value);
              }}
            />
          </div>
          <div className="r-form-field">
            <span className="r-label">Voice</span>
            <div className="r-select">
              <select
                aria-label="Voice"
                value={voiceURI}
                onChange={(e) => {
                  setVoiceURI(e.target.value);
                  store.set("voice", e.target.value);
                }}
              >
                <option value="">Default</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
            <button className="r-btn" disabled={!audioOn} onClick={() => startBeeps(3)}>Test beeps</button>
            <button className="r-btn" disabled={!audioOn} onClick={() => say("Radio check.")}>Test voice</button>
          </div>
        </div>
        </Dialog>
      )}
    </div>
  );
}
