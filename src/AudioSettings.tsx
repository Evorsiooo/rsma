import { useCallback, useEffect, useRef, useState } from "react";
import { enableAudio, setVolume, speak, startBeeps } from "./audio";
import { AI_VOICES, aiStatus, DEFAULT_AI_VOICE, loadAi, onAiStatus, preloadVoice, speakAi, type AiStatus } from "./tts";
import { Dialog } from "./ui";
import type { RadioMsg } from "../shared/race";

export const audioStore = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`flagman.audio.${k}`) ?? localStorage.getItem(`flagman.driver.${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`flagman.audio.${k}`, v);
      localStorage.setItem(`flagman.driver.${k}`, v);
    } catch {
      /* private mode: settings just do not persist */
    }
  },
};

export interface AudioSettingsDialogProps {
  onClose: () => void;
  audioOn: boolean;
  onEnable: () => Promise<boolean> | void;
  onDisable?: () => void;
  vol: number;
  setVol: (v: number) => void;
  engine: "standard" | "ai";
  setEngine: (e: "standard" | "ai") => void;
  voices: SpeechSynthesisVoice[];
  voiceURI: string;
  setVoiceURI: (v: string) => void;
  aiVoice: string;
  setAiVoice: (v: string) => void;
  ai: AiStatus;
  say: (text: string) => void;
  showBeeps?: boolean;
  onTestBeeps?: () => void;
}

export function AudioSettingsDialog({
  onClose,
  audioOn,
  onEnable,
  onDisable,
  vol,
  setVol,
  engine,
  setEngine,
  voices,
  voiceURI,
  setVoiceURI,
  aiVoice,
  setAiVoice,
  ai,
  say,
  showBeeps,
  onTestBeeps,
}: AudioSettingsDialogProps) {
  return (
    <Dialog title="Audio" size="s" onClose={onClose} foot={<button className="r-btn" onClick={onClose}>Close</button>}>
      <div className="r-stack" style={{ padding: 4 }}>
        <div className="r-form-field">
          <span className="r-label">Status</span>
          <div className="r-row" style={{ alignItems: "center", gap: 8 }}>
            {!audioOn ? (
              <button
                className="r-btn is-green r-fill"
                style={{ height: 32, fontWeight: "bold" }}
                onClick={async () => {
                  await onEnable();
                }}
              >
                Enable Audio
              </button>
            ) : (
              <>
                <div className="r-lamp r-lamp--fixed" style={{ height: 26, lineHeight: "26px", flex: 1, textAlign: "center" }}>
                  AUDIO ACTIVE
                </div>
                {onDisable && (
                  <button className="r-btn" style={{ height: 26 }} onClick={onDisable}>
                    Mute
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="r-form-field">
          <span className="r-label">Volume: {vol}%</span>
          <input
            className="r-slider"
            type="range"
            min={0}
            max={100}
            value={vol}
            aria-label="Volume"
            onChange={(e) => setVol(Number(e.target.value))}
          />
        </div>

        <div className="r-form-field">
          <span className="r-label">Voice type</span>
          <div className="r-grid" style={{ ["--cols" as string]: 2 }}>
            {(["standard", "ai"] as const).map((k) => (
              <button
                key={k}
                className={`r-cell${engine === k ? " is-on" : ""}`}
                aria-pressed={engine === k}
                onClick={() => setEngine(k)}
              >
                {k === "ai" ? "AI" : "Standard"}
              </button>
            ))}
          </div>
        </div>

        {engine === "standard" ? (
          <div className="r-form-field">
            <span className="r-label">Voice</span>
            <div className="r-select">
              <select
                aria-label="Voice"
                value={voiceURI}
                onChange={(e) => setVoiceURI(e.target.value)}
              >
                <option value="">Default</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="r-form-field">
            <span className="r-label">AI voice</span>
            <div className="r-select">
              <select
                aria-label="AI voice"
                value={aiVoice}
                onChange={(e) => setAiVoice(e.target.value)}
              >
                {[...new Set(AI_VOICES.map((v) => v.group))].map((g) => (
                  <optgroup key={g} label={g}>
                    {AI_VOICES.filter((v) => v.group === g).map((v) => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {ai.state === "loading" && (
              <>
                <span className="r-label">Downloading the AI voice model, {Math.round(ai.progress * 100)}%</span>
                <div className={`r-progress${ai.progress === 0 ? " is-wait" : ""}`} style={{ ["--value" as string]: ai.progress }} role="progressbar" aria-valuenow={Math.round(ai.progress * 100)} />
              </>
            )}
            {ai.state === "failed" && (
              <div className="r-row" style={{ alignItems: "center" }}>
                <span className="r-label r-fill">AI voices could not load, the standard voice is used.</span>
                <button className="r-btn" style={{ width: 90 }} onClick={() => loadAi()}>Retry</button>
              </div>
            )}
          </div>
        )}

        <div className="r-grid" style={{ ["--cols" as string]: showBeeps ? 2 : 1 }}>
          {showBeeps && onTestBeeps && (
            <button className="r-btn" disabled={!audioOn} onClick={onTestBeeps}>Test beeps</button>
          )}
          <button
            className="r-btn"
            onClick={async () => {
              if (!audioOn) await onEnable();
              say("Radio check.");
            }}
          >
            Test voice
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export interface UseRadioTTSOptions {
  radio?: RadioMsg[];
  formatSay?: (m: RadioMsg) => string;
}

export function useRadioTTS(options: UseRadioTTSOptions = {}) {
  const { radio, formatSay } = options;
  const [audioOn, setAudioOn] = useState(false);
  const [vol, setVolState] = useState(() => Number(audioStore.get("vol") ?? 100));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURIState] = useState(() => audioStore.get("voice") ?? "");
  const [engine, setEngineState] = useState<"standard" | "ai">(() => (audioStore.get("engine") === "ai" ? "ai" : "standard"));
  const [aiVoice, setAiVoiceState] = useState(() => audioStore.get("aivoice") ?? DEFAULT_AI_VOICE);
  const [ai, setAi] = useState<AiStatus>(aiStatus());
  const [rx, setRx] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const load = () => {
      if (typeof speechSynthesis !== "undefined") {
        setVoices(speechSynthesis.getVoices());
      }
    };
    load();
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.addEventListener("voiceschanged", load);
      return () => speechSynthesis.removeEventListener("voiceschanged", load);
    }
  }, []);

  useEffect(() => {
    setVolume(vol / 100);
  }, [vol]);

  useEffect(() => onAiStatus(setAi), []);

  useEffect(() => {
    if (engine === "ai") loadAi();
  }, [engine]);

  const setVol = useCallback((v: number) => {
    setVolState(v);
    audioStore.set("vol", String(v));
  }, []);

  const setVoiceURI = useCallback((v: string) => {
    setVoiceURIState(v);
    audioStore.set("voice", v);
  }, []);

  const setEngine = useCallback((e: "standard" | "ai") => {
    setEngineState(e);
    audioStore.set("engine", e);
  }, []);

  const setAiVoice = useCallback((v: string) => {
    setAiVoiceState(v);
    audioStore.set("aivoice", v);
    preloadVoice(v);
  }, []);

  const enable = useCallback(async () => {
    const ok = await enableAudio();
    if (ok) setAudioOn(true);
    return ok;
  }, []);

  const disable = useCallback(() => {
    setAudioOn(false);
  }, []);

  const say = useCallback(
    (text: string) => {
      const standard = () => {
        setRx(true);
        speak(text, voiceURI, () => setRx(false));
      };
      if (
        engine === "ai" &&
        speakAi(
          text,
          aiVoice,
          () => setRx(false),
          standard,
          () => setRx(true),
        )
      ) {
        return;
      }
      standard();
    },
    [voiceURI, engine, aiVoice],
  );

  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!radio) return;
    if (!seen.current) {
      seen.current = new Set(radio.map((m) => m.id));
      return;
    }
    const s = seen.current;
    if (audioOn) {
      for (const m of radio) {
        if (s.has(m.id)) continue;
        s.add(m.id);
        const text = formatSay ? formatSay(m) : (m.say ?? m.text);
        if (text) say(text);
      }
    } else {
      for (const m of radio) s.add(m.id);
    }
  }, [radio, audioOn, say, formatSay]);

  return {
    audioOn,
    setAudioOn,
    enable,
    disable,
    vol,
    setVol,
    voices,
    voiceURI,
    setVoiceURI,
    engine,
    setEngine,
    aiVoice,
    setAiVoice,
    ai,
    rx,
    setRx,
    settingsOpen,
    setSettingsOpen,
    say,
  };
}
