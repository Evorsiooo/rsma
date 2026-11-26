-- Attendance: a per-session toggle. Drivers confirm through a link shortly before the session; no answer counts as absent.
-- Per session, never shared through a registration link. Opens N minutes before the start, closes N minutes after it.
ALTER TABLE session_registration ADD COLUMN attendance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_registration ADD COLUMN attendance_opens INTEGER NOT NULL DEFAULT 10;
ALTER TABLE session_registration ADD COLUMN attendance_closes INTEGER NOT NULL DEFAULT 0;
CREATE TABLE attendance (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  roblox_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  at INTEGER NOT NULL,
  -- The driver themselves, or the staff member who overrode it.
  by TEXT NOT NULL,
  PRIMARY KEY (session_id, roblox_id)
);
