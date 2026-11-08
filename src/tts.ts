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
  /** 0..1 while loading. */
  progress: number;
}

type Model = { generate: (text: string, o: { voice: string }) => Promise<{ audio: Float32Array; sampling_rate: number }> };

let status: AiStatus = { state: "idle", progress: 0 };
let model: Promise<Model | null> | null = null;
let ready: Model | null = null;
const listeners = new Set<(s: AiStatus) => void>();

const set = (s: AiStatus) => {
  status = s;
  listeners.forEach((fn) => fn(s));
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
    const onProgress = (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status !== "progress" || !e.file || !e.total) return;
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      set({ state: "loading", progress: total ? Math.min(1, loaded / total) : 0 });
    };

    model = import("kokoro-js")
      .then(async ({ KokoroTTS }) => {
        // Try WebGPU hardware acceleration first if available in the browser
        const nav = typeof navigator !== "undefined" ? (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }) : undefined;
        if (nav?.gpu?.requestAdapter) {
          try {
            const adapter = await nav.gpu.requestAdapter();
            if (adapter) {
              return await KokoroTTS.from_pretrained(MODEL, {
                dtype: "q8",
                device: "webgpu",
                progress_callback: onProgress,
              });
            }
          } catch {
            // WebGPU initialization failed or blocked, fall back to wasm
          }
        }
        return await KokoroTTS.from_pretrained(MODEL, {
          dtype: "q8",
          device: "wasm",
          progress_callback: onProgress,
        });
      })
      .then((m) => {
        ready = m as unknown as Model;
        set({ state: "ready", progress: 1 });
        // Warm up the model pipeline & cache default voice in background
        ready.generate(" ", { voice: DEFAULT_AI_VOICE }).catch(() => {});
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

/** Preload a voice embedding so subsequent speech generation doesn't suffer a download delay. */
export function preloadVoice(voiceId: string) {
  if (ready) {
    ready.generate(" ", { voice: voiceId }).catch(() => {});
  }
}

let chain: Promise<void> = Promise.resolve();

/**
 * Speak with the neural voice. Returns false when the model is not ready, so the caller speaks with the standard
 * voice at once. If synthesis fails half way, `fallback` speaks the message instead. Messages play in order.
 */
export function speakAi(
  text: string,
  voiceId: string,
  onEnd: () => void,
  fallback: () => void,
  onStart?: () => void,
): boolean {
  const m = ready;
  if (!m) return false;
  chain = chain.then(async () => {
    try {
      const a = await m.generate(text, { voice: voiceId });
      onStart?.();
      await new Promise<void>((done) => playSamples(a.audio, a.sampling_rate, done));
      onEnd();
    } catch {
      fallback();
    }
  });
  return true;
}
