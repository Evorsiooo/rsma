-- Registration settings per session (a session without a row has no registration).
CREATE TABLE session_registration (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  opens_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  drivers INTEGER NOT NULL,
  employees INTEGER NOT NULL,
  spectators INTEGER NOT NULL,
  factory_reserved INTEGER NOT NULL DEFAULT 0,
  independents INTEGER NOT NULL DEFAULT 0
);

-- One registration per person per session. team_id NULL = independent driver.
CREATE TABLE registrations (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  roblox_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  team_id TEXT,
  discord TEXT,
  grp TEXT NOT NULL DEFAULT 'unverified',
  denied INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, roblox_id)
);
