import { createStore } from 'zustand/vanilla';

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

export interface RaceStore {
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

export const raceStore = createStore<RaceStore>((set) => ({
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

  setSessionType: (type) => set((state) => {
    if (state.sessionType === type) return {};
    
    const resetDrivers: Record<string, DriverState> = {};
    state.whitelist.forEach(d => {
      resetDrivers[d.username] = {
        username: d.username,
        number: d.number,
        lastSensorId: null,
        lastSensorTime: null,
        lapsCompleted: 0,
        currentLapStartTime: null,
        bestLapTime: null,
        lastLapTime: null,
        inPitlane: false,
        intervalToAhead: null,
        gapToLeader: null,
        status: 'PITS'
      };
    });
    
    return { 
      sessionType: type,
      drivers: resetDrivers,
      leaderboard: [],
      sessionStartTime: null,
      sessionEndTime: null,
      sensorsActive: false
    };
  }),
  togglePopoutWindow: (id, isPopped) => set((state) => ({
    poppedOutWindows: isPopped 
      ? [...new Set([...state.poppedOutWindows, id])]
      : state.poppedOutWindows.filter(w => w !== id)
  })),
  setFlagStatus: (status) => set((state) => {
    const log: StewardLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      message: `${status} FLAG deployed.`,
      type: 'FLAG'
    };
    const safeLogs = state.logs && !Array.isArray(state.logs) ? state.logs : { PRACTICE: [], QUALIFYING: [], RACE: [] };
    const currentLogs = safeLogs[state.sessionType] || [];
    return { 
      flagStatus: status,
      logs: {
        ...safeLogs,
        [state.sessionType]: [log, ...currentLogs].slice(0, 1000)
      }
    };
  }),
  setLapCount: (count) => set({ lapCount: count }),
  setSessionDurationMinutes: (minutes) => set({ sessionDurationMinutes: minutes }),
  setSessionTimes: (start, end) => set({ sessionStartTime: start, sessionEndTime: end }),
  setSensorsActive: (active) => set({ sensorsActive: active }),
  updateWhitelist: (whitelist) => set((state) => {
    const drivers: Record<string, DriverState> = { ...state.drivers };
    whitelist.forEach(driver => {
      if (!drivers[driver.username]) {
        drivers[driver.username] = {
          username: driver.username,
          number: driver.number,
          lastSensorId: null,
          lastSensorTime: null,
          lapsCompleted: 0,
          currentLapStartTime: null,
          bestLapTime: null,
          lastLapTime: null,
          inPitlane: false,
          intervalToAhead: null,
          gapToLeader: null,
          status: 'PITS'
        };
      }
    });
    return { whitelist, drivers };
  }),
  updateTrackLayout: (layout) => set({ trackLayout: layout }),
  
  updateDriverState: (username, updates) => set((state) => ({
    drivers: {
      ...state.drivers,
      [username]: { ...state.drivers[username], ...updates }
    }
  })),
  toggleDriverDnf: (username) => set((state) => {
    const driver = state.drivers[username];
    if (!driver) return state;
    const newStatus = driver.status === 'DNF' ? 'TRACK' : 'DNF';
    return {
      drivers: {
        ...state.drivers,
        [username]: { ...driver, status: newStatus }
      }
    };
  }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  addLog: (log, forceSession) => set((state) => {
    const targetSession = forceSession || state.sessionType;
    const safeLogs = state.logs && !Array.isArray(state.logs) ? state.logs : { PRACTICE: [], QUALIFYING: [], RACE: [] };
    const currentLogs = safeLogs[targetSession] || [];
    const newLog = { ...log, id: Math.random().toString(36).substring(2, 9) };
    return {
      logs: {
        ...safeLogs,
        [targetSession]: [newLog, ...currentLogs].slice(0, 1000)
      }
    };
  }),
  endSessionEarly: () => set((state) => {
    const lockedDrivers: Record<string, DriverState> = {};
    Object.keys(state.drivers).forEach(username => {
      lockedDrivers[username] = {
        ...state.drivers[username],
        status: 'FINISHED'
      };
    });
    return {
      drivers: lockedDrivers,
      sessionEndTime: state.sessionType !== 'RACE' ? Date.now() : null,
      sensorsActive: false,
    };
  }),
  resetRaceState: () => set((state) => {
    const resetDrivers: Record<string, DriverState> = {};
    state.whitelist.forEach(d => {
      resetDrivers[d.username] = {
        username: d.username,
        number: d.number,
        lastSensorId: null,
        lastSensorTime: null,
        lapsCompleted: 0,
        currentLapStartTime: null,
        bestLapTime: null,
        lastLapTime: null,
        inPitlane: false,
        intervalToAhead: null,
        gapToLeader: null,
        status: 'PITS'
      };
    });
    return { 
      drivers: resetDrivers, 
      leaderboard: [], 
      sessionStartTime: null,
      sessionEndTime: null,
      sensorsActive: false
    };
  }),
  resetSessionLogsAndTiming: () => set((state) => {
    const resetDrivers: Record<string, DriverState> = {};
    state.whitelist.forEach(d => {
      resetDrivers[d.username] = {
        username: d.username,
        number: d.number,
        lastSensorId: null,
        lastSensorTime: null,
        lapsCompleted: 0,
        currentLapStartTime: null,
        bestLapTime: null,
        lastLapTime: null,
        inPitlane: false,
        intervalToAhead: null,
        gapToLeader: null,
        status: 'PITS'
      };
    });

    const safeLogs = state.logs && !Array.isArray(state.logs) ? state.logs : { PRACTICE: [], QUALIFYING: [], RACE: [] };
    
    return { 
      drivers: resetDrivers, 
      leaderboard: [], 
      logs: {
        ...safeLogs,
        [state.sessionType]: []
      }
    };
  }),
  hardResetState: () => set({
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
    logs: { PRACTICE: [], QUALIFYING: [], RACE: [] },
    poppedOutWindows: [],
  })
}));
