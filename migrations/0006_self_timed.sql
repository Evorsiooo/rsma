-- Practice sessions the teams time themselves.
ALTER TABLE sessions ADD COLUMN self_timed INTEGER NOT NULL DEFAULT 0;
