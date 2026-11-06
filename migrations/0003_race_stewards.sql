-- Stewards assigned to one race only, without site-wide steward access.
CREATE TABLE race_stewards (
  race_id TEXT NOT NULL REFERENCES races (id) ON DELETE CASCADE,
  roblox_id TEXT NOT NULL REFERENCES users (roblox_id) ON DELETE CASCADE,
  PRIMARY KEY (race_id, roblox_id)
);
