export function playStartSequence(volume: number = 0.8, playAt: number = 0) {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContext) return;
  
  const ctx = new AudioContext();
  
  // Calculate delay if playAt is in the future
  const delaySecs = playAt > Date.now() ? (playAt - Date.now()) / 1000 : 0;
  const startTime = ctx.currentTime + delaySecs;

  const playBeep = (freq: number, offset: number, duration: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    const t = startTime + offset;

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    
    // Envelope to avoid popping
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.05);
    gain.gain.setValueAtTime(volume, t + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(t);
    osc.stop(t + duration);
  };

  // Beep 1
  playBeep(500, 0, 0.3);
  // Beep 2
  playBeep(500, 1.0, 0.3);
  // Beep 3
  playBeep(500, 2.0, 0.3);
  // Final Long Beep
  playBeep(800, 3.0, 0.8);
}
