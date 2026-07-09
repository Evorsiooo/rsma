import { create } from 'zustand';

export interface SensorHit {
  username: string;
  sensorId: number;
  timestamp: number;
}

interface SensorDebuggerStore {
  isRecording: boolean;
  recordedHits: SensorHit[];
  
  setIsRecording: (recording: boolean) => void;
  addHits: (hits: SensorHit[]) => void;
  clearHits: () => void;
}

export const useSensorDebuggerStore = create<SensorDebuggerStore>((set, get) => ({
  isRecording: false,
  recordedHits: [],
  
  setIsRecording: (recording) => set({ isRecording: recording }),
  addHits: (hits) => {
    if (!get().isRecording) return;
    set((state) => ({
      // Keep the last 1000 hits to avoid memory leaks
      recordedHits: [...state.recordedHits, ...hits].slice(-1000)
    }));
  },
  clearHits: () => set({ recordedHits: [] }),
}));
