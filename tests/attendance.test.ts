import assert from "node:assert/strict";
import { test } from "node:test";
import { attendancePhase, attendanceWindow, cleanMinutes, whoIsPresent, type AttendanceSettings, type AttendanceStatus } from "../shared/attendance.ts";

const start = Date.UTC(2026, 10, 28, 18, 0);
const on: AttendanceSettings = { attendance: true, attendanceOpens: 10, attendanceCloses: 0 };
const MIN = 60_000;

test("the window opens before the start and closes after it", () => {
  assert.deepEqual(attendanceWindow(on, start), { opensAt: start - 10 * MIN, closesAt: start });
  assert.deepEqual(attendanceWindow({ attendanceOpens: 30, attendanceCloses: 5 }, start), { opensAt: start - 30 * MIN, closesAt: start + 5 * MIN });
});

test("phases follow the clock, and off means off", () => {
  assert.equal(attendancePhase(on, start, start - 11 * MIN), "upcoming");
  assert.equal(attendancePhase(on, start, start - 10 * MIN), "open");
  assert.equal(attendancePhase(on, start, start - 1), "open");
  assert.equal(attendancePhase(on, start, start), "closed");
  assert.equal(attendancePhase({ ...on, attendance: false }, start, start - MIN), "off");
  assert.equal(attendancePhase(null, start, start - MIN), "off");
});

test("with attendance on only drivers marked present are staged, no answer counts as absent", () => {
  const drivers = [{ userId: "a" }, { userId: "b" }, { userId: "c" }];
  const status = new Map<string, AttendanceStatus>([["a", "present"], ["b", "absent"]]);
  assert.deepEqual(whoIsPresent(drivers, on, status), [{ userId: "a" }]);
  assert.deepEqual(whoIsPresent(drivers, { attendance: false }, status), drivers);
  assert.deepEqual(whoIsPresent(drivers, null, status), drivers);
});

test("minutes must be whole numbers in range", () => {
  assert.equal(cleanMinutes(0), 0);
  assert.equal(cleanMinutes(10), 10);
  assert.equal(cleanMinutes(721), null);
  assert.equal(cleanMinutes(-1), null);
  assert.equal(cleanMinutes(1.5), null);
  assert.equal(cleanMinutes("5"), null);
});
