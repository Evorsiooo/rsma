export type Flag = "green" | "yellow" | "red";
export type RunStatus = "queued" | "onstage" | "finished" | "dnf";

export interface Penalty {
  ruleId: string;
  name: string;
  ms: number;
}

export interface Run {
  id: string;
  name: string;
  plate: string;
  status: RunStatus;
  /** Server time (ms) the timer starts. In the future during the start countdown. */
  startedAt?: number;
  /** Raw stage time in ms, set when finished. */
  rawMs?: number;
  penalties: Penalty[];
  /** Sum of penalties in ms. */
  penaltyMs: number;
}

export interface Rule {
  id: string;
  name: string;
  seconds: number;
}

export interface RadioMsg {
  id: string;
  at: number;
  /** "all" or the ids of the runs addressed. */
  to: "all" | string[];
  text: string;
  from: string;
}

export interface LogEntry {
  at: number;
  actor: string;
  text: string;
}

export interface RaceState {
  flag: Flag;
  runs: Run[];
  rules: Rule[];
  /** Seconds between releases. */
  cadenceSec: number;
  lastReleaseAt?: number;
  /** Finish-line timestamps not yet attributed to a car. */
  pending: number[];
  radio: RadioMsg[];
  /** Staff only: stripped from the public view. */
  log: LogEntry[];
}

export const COUNTDOWN_MS = 3000;

export const DEFAULT_RULES: Rule[] = [
  { id: "track-limit", name: "Track limit", seconds: 5 },
  { id: "jump-start", name: "Jump start", seconds: 10 },
  { id: "unsafe-reentry", name: "Unsafe re-entry", seconds: 15 },
  { id: "missed-checkpoint", name: "Missed checkpoint", seconds: 30 },
];

export const emptyState = (): RaceState => ({
  flag: "green",
  runs: [],
  rules: structuredClone(DEFAULT_RULES),
  cadenceSec: 30,
  pending: [],
  radio: [],
  log: [],
});

export const publicView = (s: RaceState): RaceState => ({ ...s, log: [] });

export interface Row extends Run {
  /** 1-based rank, only for finished runs. */
  rank?: number;
  finalMs?: number;
}

const ORDER: Record<RunStatus, number> = { finished: 0, onstage: 1, queued: 2, dnf: 3 };

/** Finished runs ranked by final time, then on stage, queued, DNF in entry order. */
export function classify(runs: Run[]): Row[] {
  const rows: Row[] = runs.map((r) => ({
    ...r,
    finalMs: r.status === "finished" && r.rawMs != null ? r.rawMs + r.penaltyMs : undefined,
  }));
  rows.sort((a, b) => {
    if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
    if (a.finalMs != null && b.finalMs != null) return a.finalMs - b.finalMs;
    return 0;
  });
  let rank = 0;
  for (const r of rows) if (r.finalMs != null) r.rank = ++rank;
  return rows;
}

/** mm:ss.mmm */
export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = Math.floor(ms % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}

/** +5.000 */
export function fmtPenalty(ms: number): string {
  return `+${(ms / 1000).toFixed(3)}`;
}
