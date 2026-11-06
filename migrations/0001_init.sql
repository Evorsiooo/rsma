CREATE TABLE races (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
