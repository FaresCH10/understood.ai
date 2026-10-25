ALTER TABLE site_settings ADD COLUMN staff_interface_language text NOT NULL DEFAULT 'en'
  CHECK (staff_interface_language IN ('en','ar'));
ALTER TABLE site_settings ADD COLUMN first_run_completed_at timestamptz;
-- Existing sites were configured before this marker existed; only newly registered sites start uncompleted.
UPDATE site_settings SET first_run_completed_at = clock_timestamp();
