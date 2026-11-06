-- Factory teams run their own car; customer teams run a factory team's car.
ALTER TABLE teams ADD COLUMN kind TEXT NOT NULL DEFAULT 'factory';
ALTER TABLE teams ADD COLUMN car TEXT;
ALTER TABLE teams ADD COLUMN factory_id TEXT;
