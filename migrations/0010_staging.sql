-- Stewards can only stage drivers by hand in sessions where this is ticked.
ALTER TABLE sessions ADD COLUMN staging INTEGER NOT NULL DEFAULT 0;
