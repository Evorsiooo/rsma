-- Endurance events: teams enter cars that hold a ranked list of drivers. All additive; events with endurance = 0 are untouched.
-- Per event (stored on the first session of a registration group and shared by linked sessions like the other numbers):
-- whether cars are used, the most cars one team can enter, and the most drivers that race in one car.
ALTER TABLE session_registration ADD COLUMN endurance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_registration ADD COLUMN cars_per_team INTEGER NOT NULL DEFAULT 0;
ALTER TABLE session_registration ADD COLUMN seats_per_car INTEGER NOT NULL DEFAULT 0;

-- A car a team enters. root_session is the first session of the registration group, like registrations.
-- seats is how many of its drivers race (the team's own choice, at most seats_per_car); the rest are reserve.
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  root_session TEXT NOT NULL,
  team_id TEXT NOT NULL,
  label TEXT NOT NULL,
  number TEXT,
  plate TEXT,
  seats INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX entries_root ON entries (root_session);
-- Car numbers are unique within an event.
CREATE UNIQUE INDEX entries_number ON entries (root_session, number) WHERE number IS NOT NULL;

-- The ranked drivers of a car. Rank 1 is first; the first `seats` race, the rest are reserve.
-- A driver sits in one car per event.
CREATE TABLE entry_drivers (
  entry_id TEXT NOT NULL,
  root_session TEXT NOT NULL,
  roblox_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (entry_id, roblox_id)
);
CREATE UNIQUE INDEX entry_drivers_one_car ON entry_drivers (root_session, roblox_id);
