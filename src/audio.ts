// Driver audio: Web Audio beeps and speech synthesis. Both need a user gesture first (autoplay rules).
let ctx: AudioContext | null = null;
let volume = 1;

export const audioReady = () => ctx?.state === "running";

/** Call from a click handler. */
export async function enableAudio(): Promise<boolean> {
  if (!ctx) ctx = new AudioContext();
  await ctx.resume();
  // Speaking once inside the gesture unlocks speech synthesis in Safari and Chrome.
  const u = new SpeechSynthesisUtterance("");
  speechSynthesis.speak(u);
  return ctx.state === "running";
}

export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
}

/** Beep `delaySec` from now. */
export function beep(delaySec: number, freq: number, durSec: number) {
  if (!ctx || ctx.state !== "running" || volume === 0) return;
  const t = ctx.currentTime + Math.max(0, delaySec);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.2 * volume, t);
  gain.gain.setValueAtTime(0, t + durSec);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + durSec + 0.02);
}

/** Three short beeps then a long one at `goInSec` seconds from now (3 s countdown). */
export function startBeeps(goInSec: number) {
  for (const k of [3, 2, 1]) if (goInSec - k >= 0) beep(goInSec - k, 880, 0.15);
  beep(goInSec, 1320, 0.6);
}

export function speak(text: string, voiceURI: string, onEnd?: () => void) {
  if (volume === 0) return onEnd?.();
  const u = new SpeechSynthesisUtterance(text);
  const v = speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI);
  if (v) u.voice = v;
  u.volume = volume;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
}

export function spokenTime(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(1);
  return `${m ? `${m} minute${m > 1 ? "s" : ""} ` : ""}${s} seconds`;
}
