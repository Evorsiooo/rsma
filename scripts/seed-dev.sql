-- Local development only. Apply with: wrangler d1 execute flagman --local --file=scripts/seed-dev.sql
INSERT OR IGNORE INTO races (id, name, status, expires_at, created_at) VALUES
  ('race_dev_1', 'Test Stage 1', 'active', 4102444800000, 1790000000000);
INSERT OR IGNORE INTO sessions (id, race_id, name, type, position, starts_at, ends_at, created_at) VALUES
  ('race_dev_1', 'race_dev_1', 'Timed event', 'timed', 0, 1790000000000, 4102444800000, 1790000000000);
