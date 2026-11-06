export type Flag = "green" | "yellow" | "red";
export type RunStatus = "queued" | "onstage" | "finished" | "dnf";

export interface Run {
  id: string;
  name: string;
  plate: string;
  status: RunStatus;
  /** Raw stage time in ms, set when finished. */
  rawMs?: number;
  /** Sum of applied penalties in ms. */
  penaltyMs: number;
}

export interface RaceState {
  flag: Flag;
  runs: Run[];
}

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
  const t = ms % 1000;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(t).padStart(3, "0")}`;
}

/** +5.000 */
export function fmtPenalty(ms: number): string {
  return `+${(ms / 1000).toFixed(3)}`;
}

export const EMPTY_STATE: RaceState = { flag: "green", runs: [] };
