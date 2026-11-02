export function ensureCompetencySchema(db){
  if(!db.prepare('PRAGMA table_info(briefings)').all().some(column=>column.name==='competency_validity_days'))
    db.exec('ALTER TABLE briefings ADD COLUMN competency_validity_days INTEGER CHECK(competency_validity_days IS NULL OR competency_validity_days BETWEEN 1 AND 3650)');
  db.exec(`CREATE TABLE IF NOT EXISTS worker_competencies (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    worker_id TEXT NOT NULL REFERENCES workers(id),briefing_id TEXT NOT NULL REFERENCES briefings(id),
    publication_id TEXT NOT NULL REFERENCES publications(id),assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),
    attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 120),
    language TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('typed','audio')),
    awarded_at TEXT NOT NULL,expires_at TEXT NOT NULL,CHECK(expires_at>awarded_at)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_competencies_scope_expiry ON worker_competencies(org_id,site_id,expires_at,worker_id);
  CREATE INDEX IF NOT EXISTS idx_competencies_worker ON worker_competencies(worker_id,expires_at);
  CREATE TRIGGER IF NOT EXISTS worker_competency_award_valid BEFORE INSERT ON worker_competencies
    WHEN NOT EXISTS(
      SELECT 1 FROM attempts t
      JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id AND a.site_id=NEW.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id AND b.site_id=p.site_id
      WHERE t.id=NEW.attempt_id AND t.org_id=NEW.org_id AND t.assignment_id=NEW.assignment_id AND t.outcome='matched'
        AND t.received_at=NEW.awarded_at
        AND a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.worker_id=NEW.worker_id AND a.language=NEW.language
        AND p.id=NEW.publication_id AND p.org_id=NEW.org_id
        AND b.id=NEW.briefing_id AND b.org_id=NEW.org_id
        AND json_type(p.snapshot_json,'$.competency.validityDays')='integer'
        AND json_extract(p.snapshot_json,'$.competency.validityDays') BETWEEN 1 AND 3650
        AND NEW.title=json_extract(p.snapshot_json,'$.competency.title')
        AND abs((julianday(NEW.expires_at)-julianday(NEW.awarded_at))-json_extract(p.snapshot_json,'$.competency.validityDays'))<0.00002)
    BEGIN SELECT RAISE(ABORT,'Competency award is invalid'); END;
  CREATE TRIGGER IF NOT EXISTS worker_competency_update BEFORE UPDATE ON worker_competencies
    BEGIN SELECT RAISE(ABORT,'Competency awards are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS worker_competency_delete BEFORE DELETE ON worker_competencies
    BEGIN SELECT RAISE(ABORT,'Competency awards are immutable'); END;`);
}
