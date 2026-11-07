-- Access-token sign-in: a system switch, one hashed code per user, and a failed-attempt counter.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE access_codes (
  roblox_id TEXT PRIMARY KEY REFERENCES users(roblox_id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  last_used INTEGER
);

CREATE TABLE login_attempts (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);
