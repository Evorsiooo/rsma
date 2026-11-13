-- Most drivers each team fields in one session (NULL: no limit), when teams must have chosen them by (NULL: session start),
-- and the drivers a team chose for a session.
ALTER TABLE session_registration ADD COLUMN team_limit INTEGER;
ALTER TABLE session_registration ADD COLUMN pick_cutoff INTEGER;
CREATE TABLE session_picks (
  session_id TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  PRIMARY KEY (session_id, roblox_id)
);
