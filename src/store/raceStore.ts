import { create } from 'zustand';

export type SessionType = 'PRACTICE' | 'QUALIFYING' | 'RACE';
export type FlagStatus = 'GREEN' | 'YELLOW' | 'RED';

export interface WhitelistDriver {
  username: string;
  number: string;
}

export interface TrackLayout {
  sensors: number[];
  pitlaneStartSensor: number | null;
  postPitlaneSensor: number | null;
}

export interface DriverState {
  username: string;
  number: string;
  lastSensorId: number | null;
  lastSensorTime: number | null;
  lapsCompleted: number;
  currentLapStartTime: number | null;
  bestLapTime: number | null;
  lastLapTime: number | null;
  inPitlane: boolean;
  intervalToAhead: number | null;
  gapToLeader: number | null;
  status: 'TRACK' | 'PITS' | 'FINISHED' | 'OUT' | 'DNF';
}

export interface StewardLog {
  id: string;
  timestamp: number;
  message: string;
  type: 'OVERTAKE' | 'FLAG' | 'MESSAGE' | 'SYSTEM' | 'LAP_COMPLETED';
}

interface RaceStore {
  sessionType: SessionType;
  flagStatus: FlagStatus;
  lapCount: number;
  sessionDurationMinutes: number;
  sessionStartTime: number | null;
  sessionEndTime: number | null;
  whitelist: WhitelistDriver[];
  trackLayout: TrackLayout;
  sensorsActive: boolean;

  drivers: Record<string, DriverState>;
  leaderboard: string[];
  logs: {
    PRACTICE: StewardLog[];
    QUALIFYING: StewardLog[];
    RACE: StewardLog[];
  };
  poppedOutWindows: string[];

  // WebSocket Connection Status
  isConnected: boolean;
  sendAction: (action: string, ...payload: any[]) => void;
  sendRawEvent: (type: string, payload: any) => void;

  setSessionType: (type: SessionType) => void;
  setFlagStatus: (status: FlagStatus) => void;
  setLapCount: (count: number) => void;
  setSessionDurationMinutes: (minutes: number) => void;
  setSessionTimes: (start: number | null, end: number | null) => void;
  setSensorsActive: (active: boolean) => void;
  updateWhitelist: (drivers: WhitelistDriver[]) => void;
  updateTrackLayout: (layout: TrackLayout) => void;
  togglePopoutWindow: (id: string, isPopped: boolean) => void;
  
  updateDriverState: (username: string, updates: Partial<DriverState>) => void;
  toggleDriverDnf: (username: string) => void;
  setLeaderboard: (leaderboard: string[]) => void;
  addLog: (log: Omit<StewardLog, 'id'>, forceSession?: SessionType) => void;
  endSessionEarly: () => void;
  resetRaceState: () => void;
  resetSessionLogsAndTiming: () => void;
  hardResetState: () => void;
}

let ws: WebSocket | null = null;

export const useRaceStore = create<RaceStore>()((set, get) => ({
  sessionType: 'PRACTICE',
  flagStatus: 'GREEN',
  lapCount: 10,
  sessionDurationMinutes: 15,
  sessionStartTime: null,
  sessionEndTime: null,
  whitelist: [],
  trackLayout: {
    sensors: [],
    pitlaneStartSensor: null,
    postPitlaneSensor: null,
  },
  sensorsActive: false,
  drivers: {},
  leaderboard: [],
  logs: {
    PRACTICE: [],
    QUALIFYING: [],
    RACE: []
  },
  poppedOutWindows: [],
  isConnected: false,

  sendAction: (action, ...payload) => {
    // Actions modifying poppedOutWindows should remain local to the frontend
    if (action === "togglePopoutWindow") {
      const [id, isPopped] = payload;
      set((state) => ({
        poppedOutWindows: isPopped 
          ? [...new Set([...state.poppedOutWindows, id])]
          : state.poppedOutWindows.filter(w => w !== id)
      }));
      return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ACTION", action, payload }));
    } else {
      console.warn("WebSocket not connected, dropping action", action);
    }
  },

  sendRawEvent: (type, payload) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  },

  setSessionType: (type) => get().sendAction("setSessionType", type),
  setFlagStatus: (status) => get().sendAction("setFlagStatus", status),
  setLapCount: (count) => get().sendAction("setLapCount", count),
  setSessionDurationMinutes: (minutes) => get().sendAction("setSessionDurationMinutes", minutes),
  setSessionTimes: (start, end) => get().sendAction("setSessionTimes", start, end),
  setSensorsActive: (active) => get().sendAction("setSensorsActive", active),
  updateWhitelist: (whitelist) => get().sendAction("updateWhitelist", whitelist),
  updateTrackLayout: (layout) => get().sendAction("updateTrackLayout", layout),
  togglePopoutWindow: (id, isPopped) => get().sendAction("togglePopoutWindow", id, isPopped),
  updateDriverState: (username, updates) => get().sendAction("updateDriverState", username, updates),
  toggleDriverDnf: (username) => get().sendAction("toggleDriverDnf", username),
  setLeaderboard: (leaderboard) => get().sendAction("setLeaderboard", leaderboard),
  addLog: (log, forceSession) => get().sendAction("addLog", log, forceSession),
  endSessionEarly: () => get().sendAction("endSessionEarly"),
  resetRaceState: () => get().sendAction("resetRaceState"),
  resetSessionLogsAndTiming: () => get().sendAction("resetSessionLogsAndTiming"),
  hardResetState: () => get().sendAction("hardResetState"),
}));

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/live`;
  
  ws = new WebSocket(url);

  ws.onopen = () => {
    useRaceStore.setState({ isConnected: true });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "INIT" || msg.type === "STATE_UPDATE") {
        // Update the local state with the backend state, except for poppedOutWindows
        const state = msg.payload;
        const localPoppedOut = useRaceStore.getState().poppedOutWindows;
        
        useRaceStore.setState({ 
          ...state,
          poppedOutWindows: localPoppedOut 
        });
      } else if (msg.type === "TTS_MESSAGE") {
        // The Audio widget will intercept this via another mechanism, or we can dispatch it globally
        window.dispatchEvent(new CustomEvent("rsma_radio_message", { detail: msg.payload }));
      } else if (msg.type === "START_SEQUENCE") {
        // Trigger start sequence
        window.dispatchEvent(new CustomEvent("rsma_start_sequence"));
      }
    } catch (e) {
      console.error("Error parsing WebSocket message", e);
    }
  };

  ws.onclose = () => {
    useRaceStore.setState({ isConnected: false });
    // Attempt reconnect
    setTimeout(connectWebSocket, 3000);
  };
}

if (typeof window !== "undefined") {
  connectWebSocket();
}
