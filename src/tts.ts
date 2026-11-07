// AI voices: the Kokoro neural model runs in the browser on WebAssembly. It is loaded on demand, so drivers
// who keep the standard voices never download it. Until it is ready (or if it cannot load) the standard
// browser voice speaks, so a message is never lost.
import { playSamples } from "./audio";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

export interface AiVoice {
  id: string;
  label: string;
  group: string;
}

const voice = (id: string, group: string): AiVoice => ({ id, group, label: id.slice(3).replace(/^./, (c) => c.toUpperCase()) });
const ids = (group: string, list: string[]) => list.map((id) => voice(id, group));

/** English voices of the Kokoro v1.0 model. */
export const AI_VOICES: AiVoice[] = [
  ...ids("American, female", ["af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky"]),
  ...ids("American, male", ["am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck"]),
  ...ids("British, female", ["bf_alice", "bf_emma", "bf_isabella", "bf_lily"]),
  ...ids("British, male", ["bm_daniel", "bm_fable", "bm_george", "bm_lewis"]),
];
export const DEFAULT_AI_VOICE = "af_heart";

export interface AiStatus {
  state: "idle" | "loading" | "ready" | "failed";
  /** 0..1 while the model downloads. */
  progress: number;
  /** A voice's style file (about 0.5 MB) is being fetched and the voice warmed up. */
  voiceLoading: boolean;
  /** A message is being synthesised. */
  generating: boolean;
}

/** About 92 MB, shared by every voice. Each voice then adds a style file of about 0.5 MB. */
export const MODEL_SIZE_MB = 90;

type Model = { generate: (text: string, o: { voice: string }) => Promise<{ audio: Float32Array; sampling_rate: number }> };

let status: AiStatus = { state: "idle", progress: 0, voiceLoading: false, generating: false };
let model: Promise<Model | null> | null = null;
let ready: Model | null = null;
const listeners = new Set<(s: AiStatus) => void>();

const set = (patch: Partial<AiStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
};

// The model is kept in the browser cache after the first download; remember that, so it loads by itself next time.
const FLAG = "flagman.driver.aiReady";
export const wasDownloaded = () => {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
};

export const aiStatus = () => status;
export function onAiStatus(fn: (s: AiStatus) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Download and start the model. Safe to call again; a failed load is retried. */
export function loadAi(): Promise<boolean> {
  if (typeof WebAssembly === "undefined") {
    set({ state: "failed", progress: 0 });
    return Promise.resolve(false);
  }
  if (!model) {
    set({ state: "loading", progress: 0 });
    const files = new Map<string, { loaded: number; total: number }>();
    model = import("kokoro-js")
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained(MODEL, {
          dtype: "q8",
          device: "wasm",
          progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
            if (e.status !== "progress" || !e.file || !e.total) return;
            files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
              loaded += f.loaded;
              total += f.total;
            }
            set({ state: "loading", progress: total ? Math.min(1, loaded / total) : 0 });
          },
        }),
      )
      .then((m) => {
        ready = m as unknown as Model;
        try {
          localStorage.setItem(FLAG, "1");
        } catch {
          /* private mode */
        }
        set({ state: "ready", progress: 1 });
        return ready;
      })
      .catch(() => {
        model = null;
        set({ state: "failed", progress: 0 });
        return null;
      });
  }
  return model.then((m) => !!m);
}

let chain: Promise<void> = Promise.resolve();

const prepared = new Set<string>();

/**
 * Fetch a voice's style file and run one throwaway sentence, which also starts the phonemiser and the model's
 * first run. That is what made the first sentence slow, so it is done ahead of time, when a voice is chosen.
 */
export function prepareVoice(voiceId: string): void {
  const m = ready;
  if (!m || prepared.has(voiceId)) return;
  prepared.add(voiceId);
  set({ voiceLoading: true });
  chain = chain.then(async () => {
    try {
      const a = await m.generate("Radio check.", { voice: voiceId });
      cache.set(`${voiceId}|Radio check.`, { audio: a.audio, rate: a.sampling_rate });
    } catch {
      prepared.delete(voiceId);
    }
    set({ voiceLoading: false });
  });
}

// Recent sentences are kept, so repeated ones (radio check, DNF, flags) play at once.
const cache = new Map<string, { audio: Float32Array; rate: number }>();
const CACHE_MAX = 40;

/**
 * Speak with the neural voice. Returns false when the model is not ready, so the caller speaks with the standard
 * voice at once. If synthesis fails half way, `fallback` speaks the message instead. Messages play in order.
 */
export function speakAi(text: string, voiceId: string, onEnd: () => void, fallback: () => void): boolean {
  const m = ready;
  if (!m) return false;
  chain = chain.then(async () => {
    try {
      const key = `${voiceId}|${text}`;
      let hit = cache.get(key);
      if (hit) {
        cache.delete(key);
      } else {
        set({ generating: true });
        const a = await m.generate(text, { voice: voiceId });
        hit = { audio: a.audio, rate: a.sampling_rate };
        prepared.add(voiceId);
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      }
      cache.set(key, hit);
      set({ generating: false });
      const { audio, rate } = hit;
      await new Promise<void>((done) => playSamples(audio, rate, done));
      onEnd();
    } catch {
      set({ generating: false });
      fallback();
    }
  });
  return true;
}
