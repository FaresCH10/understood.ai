-- Record real session creation times without inventing dates for existing sessions.
-- Operator access is granted separately by the explicit column runtime profile;
-- credential secrets and setup tokens remain outside that profile.
ALTER TABLE sessions ADD COLUMN created_at timestamptz;
ALTER TABLE sessions ALTER COLUMN created_at SET DEFAULT clock_timestamp();
