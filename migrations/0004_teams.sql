-- Temporary team model until team registration exists. Members get access to that team's panel.
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);
CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  roblox_id TEXT NOT NULL REFERENCES users (roblox_id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, roblox_id)
);
