import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { classify, type Flag, type Run } from "../shared/race";
import type { RaceSummary } from "../shared/types";
import { api } from "./api";
import { enableAudio, setVolume, speak, spokenTime, startBeeps } from "./audio";
import { NotFound } from "./NotFound";
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
  const [race, setRace] = useState<RaceSummary | null | undefined>(undefined);
  const { state, live, offset } = useRaceLive(id);
  const [audioOn, setAudioOn] = useState(false);
  const [name, setName] = useState(() => store.get("name") ?? "");
  const [vol, setVol] = useState(() => Number(store.get("vol") ?? 100));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState(() => store.get("voice") ?? "");
  const [rx, setRx] = useState(false);

  useEffect(() => {
    api.race(id).then(setRace, () => setRace(null));
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
  const seen = useRef<{ radio: Set<string>; status: Map<string, string>; beeped: Set<string> } | null>(null);
  useEffect(() => {
    if (!state) return;
    if (!seen.current) {
      seen.current = {
        radio: new Set(state.radio.map((m) => m.id)),
        status: new Map(state.runs.map((r) => [r.id, r.status])),
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
        if (m.to === "all" || (me && m.to.includes(me.id))) say(m.text);
      }
      if (me) {
        const prev = s.status.get(me.id);
        if (prev && prev !== me.status) {
          if (me.status === "finished" && me.rawMs != null) {
            const row = classify(state.runs).find((r) => r.id === me.id);
            say(`Finished in ${spokenTime(me.rawMs + me.penaltyMs)}. Position ${row?.rank}.`);
          } else if (me.status === "dnf") say("Did not finish.");
        }
      }
    }
    for (const r of state.runs) s.status.set(r.id, r.status);
    for (const m of state.radio) s.radio.add(m.id);
  }, [state, audioOn, me, offset, say]);

  const messages = useMemo(
    () => (state?.radio ?? []).filter((m) => m.to === "all" || (me && m.to.includes(me.id))).slice(-30),
    [state, me],
  );
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length]);

  if (race === null) return <NotFound />;
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
      </div>

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
        <div className="r-header">Driver</div>
        <div className="r-stack" style={{ padding: 4, background: "var(--r-chrome)" }}>
          <div className="r-select">
            <select
              aria-label="Driver"
              value={me?.name ?? ""}
              onChange={(e) => {
                setName(e.target.value);
                store.set("name", e.target.value);
              }}
            >
              <option value="">Select driver</option>
              {[...new Set(state?.runs.map((r) => r.name))].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
        {me && (
          <table className="r-table">
            <tbody>
              <tr><td className="is-left">Status</td><td>{status}</td></tr>
              <tr><td className="is-left">Plate</td><td>{me.plate}</td></tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="r-panel r-fill" style={{ display: "flex", flexDirection: "column", minHeight: 120 }}>
        <div className="r-header">Radio</div>
        <div className="r-log r-log--wrap r-fill" ref={transcript}>
          {messages.map((m) => (
            <div className="r-log__line" key={m.id}>{hhmm(m.at)} {m.text}</div>
          ))}
        </div>
      </div>

      <div className="r-panel">
        <div className="r-header">Audio</div>
        <div className="r-stack" style={{ padding: 4, background: "var(--r-chrome)" }}>
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
      </div>
    </div>
  );
}
