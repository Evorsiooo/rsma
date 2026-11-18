-- Championship: events scored by hand (finishing order, optional run times and intervals), and the points settings.
CREATE TABLE championship_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  held_at INTEGER NOT NULL,
  half INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'position' CHECK (mode IN ('position', 'window')),
  window_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE championship_results (
  event_id TEXT NOT NULL REFERENCES championship_events (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  username TEXT NOT NULL,
  team_id TEXT,
  team_name TEXT,
  time_ms INTEGER,
  gap_ms INTEGER,
  PRIMARY KEY (event_id, position)
);
-- Points per place and the default window width live in settings under the key "standings" (JSON).
