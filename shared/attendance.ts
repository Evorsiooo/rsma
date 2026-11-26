/** Attendance: drivers confirm through a link shortly before a session. No answer counts as absent. */

export type AttendanceStatus = "present" | "absent";
export type AttendancePhase = "off" | "upcoming" | "open" | "closed";

export const ATTENDANCE_DEFAULT_OPENS = 10;
export const ATTENDANCE_DEFAULT_CLOSES = 0;
export const ATTENDANCE_MAX_MINUTES = 720;

export interface AttendanceSettings {
  attendance: boolean;
  /** Minutes before the session starts that the link opens. */
  attendanceOpens: number;
  /** Minutes after the session starts that it closes. */
  attendanceCloses: number;
}

const MIN = 60_000;

/** When the link opens and closes for a session that starts at `startsAt`. */
export function attendanceWindow(s: Pick<AttendanceSettings, "attendanceOpens" | "attendanceCloses">, startsAt: number) {
  return { opensAt: startsAt - s.attendanceOpens * MIN, closesAt: startsAt + s.attendanceCloses * MIN };
}

export function attendancePhase(s: AttendanceSettings | null, startsAt: number, now: number): AttendancePhase {
  if (!s || !s.attendance) return "off";
  const w = attendanceWindow(s, startsAt);
  return now < w.opensAt ? "upcoming" : now < w.closesAt ? "open" : "closed";
}

/** Whole minutes in a form field: null when it is not a number from 0 to the maximum. */
export function cleanMinutes(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= ATTENDANCE_MAX_MINUTES ? (v as number) : null;
}

/** The drivers a session stages: with attendance off everyone who is In, with it on only those marked present. */
export function whoIsPresent<T extends { userId: string }>(drivers: T[], settings: Pick<AttendanceSettings, "attendance"> | null, status: Map<string, AttendanceStatus>): T[] {
  return settings?.attendance ? drivers.filter((d) => status.get(d.userId) === "present") : drivers;
}

export const ATTENDANCE_LABEL: Record<AttendanceStatus | "none", string> = { present: "Present", absent: "Absent", none: "No answer" };

/** What the staff list and the driver's own page show for one driver. */
export interface AttendanceRow {
  userId: string;
  username: string;
  teamName: string | null;
  status: AttendanceStatus | null;
  at: number | null;
  /** Username of whoever set it when that was not the driver. */
  by: string | null;
}

export type AttendanceWhy = "signed_out" | "not_registered" | "not_in";

/** /api/attendance/:sid */
export interface AttendanceView {
  sessionId: string;
  sessionName: string;
  raceName: string;
  startsAt: number;
  enabled: boolean;
  phase: AttendancePhase;
  opensAt: number | null;
  closesAt: number | null;
  /** The signed-in driver may answer: registered and In for this session. */
  eligible: boolean;
  why: AttendanceWhy | null;
  team: string | null;
  status: AttendanceStatus | null;
  staff: boolean;
  /** Staff only: every driver who is In, with their answer. */
  rows: AttendanceRow[];
}
