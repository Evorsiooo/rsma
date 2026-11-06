-- Team members carry one or more roles (comma-separated). Existing members had panel access only.
ALTER TABLE team_members ADD COLUMN roles TEXT NOT NULL DEFAULT 'driver';
UPDATE team_members SET roles = 'race_engineer';
