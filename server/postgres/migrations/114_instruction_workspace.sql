
CREATE TABLE IF NOT EXISTS instruction_compositions (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL, site_id TEXT NOT NULL, staff_id TEXT NOT NULL,
 content_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compositions_scope ON instruction_compositions(org_id,site_id,staff_id);
CREATE TABLE IF NOT EXISTS instruction_attachments (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL, org_id TEXT NOT NULL, site_id TEXT NOT NULL,
 staff_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
 data_base64 TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_request ON instruction_attachments(org_id,site_id,request_id);
CREATE TABLE IF NOT EXISTS assignment_completions (
 assignment_id TEXT PRIMARY KEY REFERENCES assignments(id), org_id TEXT NOT NULL, site_id TEXT NOT NULL,
 worker_id TEXT NOT NULL, completed_at TEXT NOT NULL
);