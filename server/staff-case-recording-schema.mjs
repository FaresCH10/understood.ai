import {ensureCaseMessageSchema} from './case-messages.mjs';
import {ensureRetentionSchema} from './retention.mjs';
import {sqlLanguageList} from './languages.mjs';

export function ensureStaffCaseRecordingSchema(db){
  ensureCaseMessageSchema(db);ensureRetentionSchema(db);
  const frozen='id request_id org_id site_id assignment_id worker_id kind requested_case_id language sha256 bytes duration_seconds created_at actor_type actor_id actor_role'.split(' ').map(key=>`NEW.${key} IS NOT OLD.${key}`).join(' OR ');
  db.exec(`CREATE TABLE IF NOT EXISTS case_voice (
    id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,org_id TEXT NOT NULL REFERENCES organizations(id),site_id TEXT NOT NULL REFERENCES sites(id),
    assignment_id TEXT NOT NULL REFERENCES assignments(id),worker_id TEXT NOT NULL REFERENCES workers(id),kind TEXT NOT NULL CHECK(kind IN ('help','reply','in_person')),
    requested_case_id TEXT NOT NULL,case_id TEXT REFERENCES clarifications(id),language TEXT NOT NULL CHECK(language IN (${sqlLanguageList()})),
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),bytes INTEGER NOT NULL CHECK(bytes BETWEEN 8044 AND 2880044),
    duration_seconds REAL NOT NULL CHECK(duration_seconds BETWEEN 0.25 AND 90),status TEXT NOT NULL CHECK(status IN ('storing','received','failed')),
    created_at TEXT NOT NULL,received_at TEXT,lease_token TEXT,lease_until TEXT,
    cleanup_state TEXT NOT NULL DEFAULT 'active' CHECK(cleanup_state IN ('active','cleaning','cleaned')),cleanup_token TEXT,cleanup_until TEXT,cleanup_checked_at TEXT,
    actor_type TEXT NOT NULL DEFAULT 'worker' CHECK(actor_type IN ('worker','staff')),actor_id TEXT REFERENCES staff(id),actor_role TEXT,
    CHECK((actor_type='worker' AND kind IN ('help','reply') AND actor_id IS NULL AND actor_role IS NULL)
      OR (actor_type='staff' AND kind='in_person' AND actor_id IS NOT NULL AND actor_role IS NOT NULL AND actor_role IN ('owner','supervisor'))),
    CHECK((status='received' AND received_at IS NOT NULL AND case_id IS NOT NULL AND case_id=requested_case_id)
      OR (status IN ('storing','failed') AND received_at IS NULL AND case_id IS NULL))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS case_voice_cleanup ON case_voice(cleanup_state,lease_until,received_at);
  CREATE INDEX IF NOT EXISTS case_voice_staff_history ON case_voice(requested_case_id,created_at,id) WHERE actor_type='staff';
  CREATE TRIGGER IF NOT EXISTS case_voice_staging BEFORE INSERT ON case_voice WHEN
    NEW.status<>'storing' OR NEW.cleanup_state<>'active' OR NEW.lease_token IS NULL OR NEW.lease_until IS NULL
    OR NOT EXISTS(SELECT 1 FROM assignments a JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id AND w.active=1
      WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id AND a.worker_id=NEW.worker_id AND (NEW.actor_type='staff' OR a.language=NEW.language))
    OR EXISTS(SELECT 1 FROM worker_deletion_requests WHERE worker_id=NEW.worker_id)
    OR (NEW.actor_type='staff' AND NOT EXISTS(SELECT 1 FROM staff s JOIN clarifications c ON c.org_id=s.org_id
      JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id AND a.site_id=s.site_id
      WHERE s.id=NEW.actor_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id AND s.active=1 AND s.role=NEW.actor_role
        AND c.id=NEW.requested_case_id AND c.assignment_id=NEW.assignment_id AND c.status='open'))
    BEGIN SELECT RAISE(ABORT,'Staff recording scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS case_voice_identity BEFORE UPDATE ON case_voice WHEN ${frozen}
    OR (OLD.status='received' AND (NEW.status IS NOT OLD.status OR NEW.received_at IS NOT OLD.received_at OR NEW.case_id IS NOT OLD.case_id))
    OR (OLD.status='failed' AND NEW.status<>'failed') OR (OLD.cleanup_state='cleaned' AND NEW.cleanup_state<>'cleaned')
    OR (OLD.cleanup_state='cleaning' AND NEW.cleanup_state NOT IN ('cleaning','cleaned'))
    BEGIN SELECT RAISE(ABORT,'Voice evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS case_voice_accept BEFORE UPDATE ON case_voice WHEN NEW.status='received' AND OLD.status<>'received' AND
    ((NEW.actor_type='staff' AND NOT EXISTS(SELECT 1 FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      WHERE c.id=NEW.requested_case_id AND c.id=NEW.case_id AND c.org_id=NEW.org_id AND a.site_id=NEW.site_id AND a.id=NEW.assignment_id))
      OR (NEW.actor_type='worker' AND NOT EXISTS(SELECT 1 FROM case_messages m WHERE m.id=NEW.request_id AND m.case_id=NEW.case_id AND m.assignment_id=NEW.assignment_id
        AND m.org_id=NEW.org_id AND m.site_id=NEW.site_id AND m.actor_type='worker' AND m.actor_id=NEW.worker_id AND m.request_hash=NEW.sha256)))
    BEGIN SELECT RAISE(ABORT,'Staff recording receipt mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS case_voice_delete BEFORE DELETE ON case_voice BEGIN SELECT RAISE(ABORT,'Voice evidence is immutable'); END;`);
}
