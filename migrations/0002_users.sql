CREATE TABLE users (
  roblox_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_login INTEGER
);
CREATE INDEX users_username ON users (lower(username));

-- Site-wide roles. 'admin' implies all of them.
CREATE TABLE user_roles (
  roblox_id TEXT NOT NULL REFERENCES users (roblox_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','users','races','steward')),
  PRIMARY KEY (roblox_id, role)
);
