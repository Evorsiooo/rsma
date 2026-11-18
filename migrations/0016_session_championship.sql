-- A session can count for the championship: its finished runs score points when standings are read.
ALTER TABLE sessions ADD COLUMN championship INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN half_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN scoring TEXT NOT NULL DEFAULT 'position';
ALTER TABLE sessions ADD COLUMN window_ms INTEGER;
