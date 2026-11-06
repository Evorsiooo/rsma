-- An event (race) is made of ordered sessions. Each session has its own live state in a Durable Object.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  race_id TEXT NOT NULL REFERENCES races (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('practice','timed','race')),
  position INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_race ON sessions (race_id, position);
-- Existing events keep their live state: the session takes the event's id.
INSERT INTO sessions (id, race_id, name, type, position, starts_at, ends_at, created_at)
  SELECT id, id, 'Timed event', 'timed', 0, created_at, expires_at, created_at FROM races;
