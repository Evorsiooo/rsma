-- Local development only. Apply with: wrangler d1 execute flagman --local --file=scripts/seed-dev.sql
INSERT OR IGNORE INTO races (id, name, status, expires_at, created_at) VALUES
  ('race_dev_1', 'Test Stage 1', 'active', 4102444800000, 1790000000000);
