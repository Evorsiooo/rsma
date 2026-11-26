-- Saved tracks (the drawn circuit with its pit lane, turns and segments) and the track an event runs on.
CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  version INTEGER NOT NULL DEFAULT 1,
  geometry TEXT NOT NULL,
  -- The imported picture, shrunk in the browser to a tracing guide (a JPEG data URL). Optional.
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
ALTER TABLE races ADD COLUMN track_id TEXT;
