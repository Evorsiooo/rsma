-- Results typed in against any session (races have no live timing). One row per finishing place: a car with the drivers who
-- drove it (the stint log), or a single driver. Nothing existing is rewritten.
-- username is the first driver of the row, so a row always names someone. car is the car's name as it was when entered.
CREATE TABLE session_results (
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  car TEXT,
  username TEXT NOT NULL,
  team_id TEXT,
  team_name TEXT,
  time_ms INTEGER,
  gap_ms INTEGER,
  PRIMARY KEY (session_id, position)
);
-- Who drove each result row, in stint order; the same driver can be listed again for a later stint.
CREATE TABLE session_result_drivers (
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  username TEXT NOT NULL,
  PRIMARY KEY (session_id, position, seq)
);
