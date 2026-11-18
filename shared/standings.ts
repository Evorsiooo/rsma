/** Championship standings: points per event from finishing order (or, for timed events, from the gap to the fastest time), summed per driver and per team. */

export type ScoringMode = "position" | "window";

export interface PointsConfig {
  /** Points for first place, second place, and so on. Places past the end score nothing. */
  points: number[];
  /** Timed events in window mode: width of one window, in ms. */
  windowMs: number;
}

export const DEFAULT_CONFIG: PointsConfig = { points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], windowMs: 1500 };
export const MAX_PLACES = 50;
export const MAX_ROWS = 100;
export const MAX_WINDOW_MS = 600_000;

export interface ResultRow {
  /** 1 is the winner. */
  position: number;
  username: string;
  teamId: string | null;
  teamName: string | null;
  /** Run time; not kept for every past event. */
  timeMs: number | null;
  /** Interval to the driver ahead; not kept for every past event. */
  gapMs: number | null;
}

export interface ChampEvent {
  id: string;
  name: string;
  heldAt: number;
  half: boolean;
  mode: ScoringMode;
  /** Window width of this event; null uses the default of the points settings. */
  windowMs: number | null;
  results: ResultRow[];
  /** Scored from a session run on the website (its settings are changed there); absent for results typed in by hand. */
  sessionId?: string;
}

export interface StandingsData {
  config: PointsConfig;
  events: ChampEvent[];
}

export const cleanUsername = (v: unknown): string => (typeof v === "string" && /^[A-Za-z0-9_]{3,20}$/.test(v.trim()) ? v.trim() : "");

/** The offset of every row from the fastest time, in the order of `rows`; null when the times or intervals do not allow it. */
export function offsetsOf(rows: Pick<ResultRow, "timeMs" | "gapMs">[]): number[] | null {
  if (rows.length === 0) return [];
  if (rows.every((r) => r.timeMs != null)) {
    const best = Math.min(...rows.map((r) => r.timeMs!));
    return rows.map((r) => r.timeMs! - best);
  }
  // Intervals to the car ahead add up from the winner.
  if (rows.slice(1).every((r) => r.gapMs != null)) {
    let sum = 0;
    return rows.map((r, i) => (i === 0 ? 0 : (sum += r.gapMs!)));
  }
  return null;
}

/** Points of each row of an event, in the order of its results. In window mode the bands are (0, w], (w, 2w], ...: a gap of exactly w still counts as within the first window. */
export function eventPoints(ev: Pick<ChampEvent, "half" | "mode" | "windowMs" | "results">, cfg: PointsConfig): number[] {
  const rows = [...ev.results].sort((a, b) => a.position - b.position);
  const at = (i: number) => cfg.points[i] ?? 0;
  const offsets = ev.mode === "window" ? offsetsOf(rows) : null;
  const width = ev.windowMs ?? cfg.windowMs;
  const pts = rows.map((_, i) => (offsets && width > 0 ? at(Math.max(0, Math.ceil(offsets[i] / width) - 1)) : at(i)));
  return pts.map((p) => (ev.half ? p / 2 : p));
}

export function fmtPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

export interface Cell {
  points: number;
  /** Finishing place; for a team, its best driver's place. */
  position: number;
}

export interface Line {
  key: string;
  name: string;
  /** Drivers: the team of their latest event. */
  team: string | null;
  points: number;
  /** One per round, null where the driver or team did not take part. */
  cells: (Cell | null)[];
  wins: number;
  podiums: number;
  /** How often each place was taken, for the tiebreak. */
  places: number[];
}

export interface Standings {
  rounds: ChampEvent[];
  drivers: Line[];
  teams: Line[];
}

/** Equal points are split by who took more wins, then more second places, and so on. */
function byRank(a: Line, b: Line): number {
  if (b.points !== a.points) return b.points - a.points;
  const n = Math.max(a.places.length, b.places.length);
  for (let i = 0; i < n; i++) if ((b.places[i] ?? 0) !== (a.places[i] ?? 0)) return (b.places[i] ?? 0) - (a.places[i] ?? 0);
  return a.name.localeCompare(b.name);
}

export function computeStandings(events: ChampEvent[], cfg: PointsConfig): Standings {
  const rounds = [...events].sort((a, b) => a.heldAt - b.heldAt || a.name.localeCompare(b.name));
  const drivers = new Map<string, Line>();
  const teams = new Map<string, Line>();
  const line = (m: Map<string, Line>, key: string, name: string): Line => {
    let l = m.get(key);
    if (!l) m.set(key, (l = { key, name, team: null, points: 0, cells: rounds.map(() => null), wins: 0, podiums: 0, places: [] }));
    l.name = name;
    return l;
  };
  rounds.forEach((ev, i) => {
    const rows = [...ev.results].sort((a, b) => a.position - b.position);
    const pts = eventPoints(ev, cfg);
    rows.forEach((r, j) => {
      const d = line(drivers, r.username.toLowerCase(), r.username);
      d.cells[i] = { points: pts[j], position: r.position };
      d.points += pts[j];
      if (r.teamName) d.team = r.teamName;
      count(d, r.position);
      if (r.teamName) {
        const tk = r.teamId ?? `n:${r.teamName.toLowerCase()}`;
        const t = line(teams, tk, r.teamName);
        const cell = t.cells[i];
        t.cells[i] = { points: (cell?.points ?? 0) + pts[j], position: Math.min(cell?.position ?? Infinity, r.position) };
        t.points += pts[j];
        count(t, r.position);
      }
    });
  });
  return { rounds, drivers: [...drivers.values()].sort(byRank), teams: [...teams.values()].sort(byRank) };
}

function count(l: Line, position: number) {
  l.places[position - 1] = (l.places[position - 1] ?? 0) + 1;
  if (position === 1) l.wins++;
  if (position <= 3) l.podiums++;
}

/** "1:23.456", "83.456" or "01:23.456" as ms; null when it is not a time. */
export function parseTime(v: string): number | null {
  const m = v.trim().match(/^(?:(\d{1,3}):)?(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m || (m[1] != null && Number(m[2]) > 59)) return null;
  const ms = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
  return (Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000 + ms;
}

/** An interval such as "+0.250", "0.25" or "+1:02.5" as ms. */
export function parseGap(v: string): number | null {
  const t = v.trim().replace(/^\+/, "");
  return parseTime(t);
}

/** A window width for display: "1.5 s". */
export const fmtWindow = (ms: number) => `${Number((ms / 1000).toFixed(3))} s`;

/** A time or interval for display: seconds under a minute, minutes and seconds above. */
export function fmtSpan(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3);
  return m > 0 ? `${m}:${s.padStart(6, "0")}` : s;
}

/** What is wrong with an event, or null. Used by the form and by the server. */
export function eventProblem(ev: Pick<ChampEvent, "name" | "heldAt" | "mode" | "windowMs" | "results">): string | null {
  if (!ev.name.trim()) return "Enter a name.";
  if (!Number.isFinite(ev.heldAt)) return "Enter a date.";
  if (ev.results.length === 0) return "Add at least one driver.";
  if (ev.results.length > MAX_ROWS) return `At most ${MAX_ROWS} drivers.`;
  const seen = new Set<string>();
  for (const r of ev.results) {
    if (!cleanUsername(r.username)) return `"${r.username}" is not a Roblox username (3-20 letters, numbers or underscores).`;
    const k = r.username.toLowerCase();
    if (seen.has(k)) return `${r.username} is listed twice.`;
    seen.add(k);
  }
  if (ev.windowMs != null && !(ev.windowMs >= 1 && ev.windowMs <= MAX_WINDOW_MS)) return "The window must be between 1 ms and 10 minutes.";
  if (ev.mode === "window" && offsetsOf([...ev.results].sort((a, b) => a.position - b.position)) == null) return "Windows need a run time for every driver, or an interval for every driver after the winner.";
  return null;
}

export function configProblem(cfg: PointsConfig): string | null {
  if (cfg.points.length === 0) return "Enter points for at least first place.";
  if (cfg.points.length > MAX_PLACES) return `At most ${MAX_PLACES} places.`;
  if (!cfg.points.every((p) => Number.isFinite(p) && p >= 0 && p <= 1000)) return "Points are numbers from 0 to 1000.";
  if (!(Number.isInteger(cfg.windowMs) && cfg.windowMs >= 1 && cfg.windowMs <= MAX_WINDOW_MS)) return "The window must be between 1 ms and 10 minutes.";
  return null;
}
