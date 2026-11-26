import { Hono, type Context } from "hono";
import { attendancePhase, attendanceWindow, type AttendanceRow, type AttendanceStatus, type AttendanceView } from "../shared/attendance";
import type { Me } from "../shared/types";
import type { AdminEnv } from "./admin";
import { attendanceOf, driversIn, isStaff, loadEventData, settingsIn, type EventData } from "./reg-data";
import { syncRegistered } from "./stage";

type E = { Bindings: AdminEnv; Variables: { me: Me | null } };
type C = Context<E>;

export const attendance = new Hono<E>();

const cleanStatus = (v: unknown): AttendanceStatus | null => (v === "present" || v === "absent" ? v : null);

/** Who is asking and what is true now, worked out from one read of the event. */
export function attendanceView(d: EventData, sid: string, now = Date.now()): AttendanceView | null {
  const session = d.race?.sessions.find((s) => s.id === sid);
  const settings = settingsIn(d, sid);
  if (!d.race || !session) return null;
  const phase = attendancePhase(settings, session.startsAt, now);
  const window = settings?.attendance ? attendanceWindow(settings, session.startsAt) : null;
  const answers = attendanceOf(d, sid);
  const rowsDb = new Map(d.attendance.filter((a) => a.sessionId === sid).map((a) => [a.userId, a]));
  const drivers = driversIn(d, sid);
  const staff = isStaff(d.me);
  const self = d.me ? drivers.find((r) => r.userId === d.me!.id) : undefined;
  const registered = d.me ? d.regs.some((r) => r.userId === d.me!.id && r.kind === "driver") : false;
  const rows: AttendanceRow[] = staff
    ? drivers.map((r) => {
        const a = rowsDb.get(r.userId);
        return { userId: r.userId, username: r.username, teamName: r.teamName, status: a?.status ?? null, at: a?.at ?? null, by: a && a.by.toLowerCase() !== r.username.toLowerCase() ? a.by : null };
      })
    : [];
  return {
    sessionId: sid,
    sessionName: session.name,
    raceName: d.race.name,
    startsAt: session.startsAt,
    enabled: !!settings?.attendance,
    phase,
    opensAt: window?.opensAt ?? null,
    closesAt: window?.closesAt ?? null,
    eligible: !!self,
    why: !d.me ? "signed_out" : self ? null : registered ? "not_in" : "not_registered",
    team: self?.teamName ?? null,
    status: d.me ? (answers.get(d.me.id) ?? null) : null,
    staff,
    rows,
  };
}

attendance.get("/:sid", async (c) => {
  const sid = c.req.param("sid");
  const v = attendanceView(await loadEventData(c.env, c, { sessionId: sid }), sid);
  return v ? c.json(v) : c.json({ error: "not_found" }, 404);
});

/** Staging the queue is not needed for the answer: answer now, finish it right after. */
const syncLater = (c: C, sid: string) => c.executionCtx.waitUntil(syncRegistered(c.env, sid).catch((e) => console.error("syncRegistered failed", e)));

/** A driver answers for themselves while attendance is open. */
attendance.put("/:sid", async (c) => {
  const sid = c.req.param("sid");
  const d = await loadEventData(c.env, c, { sessionId: sid });
  if (!d.me) return c.json({ error: "unauthorized" }, 401);
  const v = attendanceView(d, sid);
  if (!v) return c.json({ error: "not_found" }, 404);
  if (!v.enabled) return c.json({ error: "attendance_off" }, 409);
  if (v.phase !== "open") return c.json({ error: v.phase === "upcoming" ? "not_open" : "closed" }, 409);
  if (!v.eligible) return c.json({ error: "not_eligible" }, 403);
  const status = cleanStatus(((await c.req.json().catch(() => ({}))) as { status?: unknown }).status);
  if (!status) return c.json({ error: "invalid" }, 400);
  await write(c, sid, d.me.id, status, d.me.username);
  syncLater(c, sid);
  return c.json({ ok: true, status });
});

/** Staff set or clear anyone's answer at any time. */
attendance.put("/:sid/:uid", async (c) => {
  const sid = c.req.param("sid");
  const d = await loadEventData(c.env, c, { sessionId: sid });
  if (!d.me) return c.json({ error: "unauthorized" }, 401);
  if (!isStaff(d.me)) return c.json({ error: "forbidden" }, 403);
  const v = attendanceView(d, sid);
  if (!v) return c.json({ error: "not_found" }, 404);
  if (!v.enabled) return c.json({ error: "attendance_off" }, 409);
  const uid = c.req.param("uid");
  if (!driversIn(d, sid).some((r) => r.userId === uid)) return c.json({ error: "not_eligible" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { status?: unknown };
  if (body.status === null) await c.env.DB.prepare("DELETE FROM attendance WHERE session_id = ? AND roblox_id = ?").bind(sid, uid).run();
  else {
    const status = cleanStatus(body.status);
    if (!status) return c.json({ error: "invalid" }, 400);
    await write(c, sid, uid, status, d.me.username);
  }
  syncLater(c, sid);
  return c.json({ ok: true });
});

/** `by` is the username of whoever set it: the driver, or the staff member who overrode it. */
const write = (c: C, sid: string, uid: string, status: AttendanceStatus, by: string) =>
  c.env.DB.prepare(
    `INSERT INTO attendance (session_id, roblox_id, status, at, by) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(session_id, roblox_id) DO UPDATE SET status = ?3, at = ?4, by = ?5`,
  )
    .bind(sid, uid, status, Date.now(), by)
    .run();
