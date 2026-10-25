import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureDeletionSchema} from './deletions.mjs';
import {ensureRetentionSchema} from './retention.mjs';
import {ensureClarificationSchema} from './clarifications.mjs';
import {ensureExportSchema} from './exports.mjs';
import {ensureWorkerImportSchema} from './worker-import.mjs';
import {ensurePeopleSchema} from './people.mjs';
import {ensureCaseMessageSchema} from './case-messages.mjs';
import {ensurePresentationSchema} from './presentation-schema.mjs';
import {ensureInstructionSchema} from './instruction-schema.mjs';

export function ensureDeletionRedactionSchema(db){
  ensureDeletionSchema(db);ensureRetentionSchema(db);ensureClarificationSchema(db);ensureExportSchema(db);ensureWorkerImportSchema(db);
  ensurePeopleSchema(db);
  ensureCaseMessageSchema(db);
  ensurePresentationSchema(db);
  ensureInstructionSchema(db);
  const receiptGuard=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='directory_reactivation_frozen_update'").get()?.sql;
  if(!receiptGuard?.includes('worker_deletion_requests'))db.exec(`DROP TRIGGER IF EXISTS directory_reactivation_frozen_update;
    CREATE TRIGGER directory_reactivation_frozen_update BEFORE UPDATE ON directory_reactivations WHEN
      NEW.request_id IS NOT OLD.request_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.worker_id IS NOT OLD.worker_id OR NEW.crew_id IS NOT OLD.crew_id
      OR NEW.requested_by IS NOT OLD.requested_by OR NEW.occurred_at IS NOT OLD.occurred_at
      OR NEW.expected_label<>'[Deleted]' OR NOT EXISTS(SELECT 1 FROM worker_deletion_requests d
        WHERE d.worker_id=OLD.worker_id AND d.org_id=OLD.org_id AND d.site_id=OLD.site_id)
      BEGIN SELECT RAISE(ABORT,'Reactivation receipt is immutable'); END;`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS directory_reactivation_deletion_fence BEFORE INSERT ON directory_reactivations WHEN
    EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=NEW.worker_id)
    BEGIN SELECT RAISE(ABORT,'Worker deletion pending'); END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS worker_deletion_redactions (
    request_id TEXT PRIMARY KEY REFERENCES worker_deletion_requests(id),org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    worker_id TEXT NOT NULL UNIQUE REFERENCES workers(id),completed_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS deletion_redaction_scope BEFORE INSERT ON worker_deletion_redactions WHEN
    NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.id=NEW.request_id AND d.worker_id=NEW.worker_id AND d.org_id=NEW.org_id AND d.site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Redaction scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS attempt_deletion_fence BEFORE UPDATE ON attempts WHEN
    EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=OLD.assignment_id)
    AND (NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.assignment_id IS NOT OLD.assignment_id
      OR NEW.submission_id IS NOT OLD.submission_id OR NEW.received_at IS NOT OLD.received_at OR NEW.outcome IS NOT OLD.outcome
      OR NEW.answer_text<>'[Deleted]' OR NEW.reasons_json<>'{"reasons":[],"evidence":[]}')
    BEGIN SELECT RAISE(ABORT,'Deleted content is immutable'); END;`);
  for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS deletion_redaction_frozen_${action.toLowerCase()}
    BEFORE ${action} ON worker_deletion_redactions BEGIN SELECT RAISE(ABORT,'Redaction receipt is immutable'); END;`);
}

export function processOneDeletionRedaction(db){
  ensureDeletionRedactionSchema(db);
  return transaction(db,()=>{
    const legacy=db.prepare(`SELECT d.* FROM worker_deletion_requests d WHERE EXISTS(
      SELECT 1 FROM directory_reactivations r WHERE r.worker_id=d.worker_id AND r.org_id=d.org_id
        AND r.site_id=d.site_id AND r.expected_label<>'[Deleted]') ORDER BY d.created_at,d.id LIMIT 1`).get();
    if(legacy){
      db.prepare("UPDATE directory_reactivations SET expected_label='[Deleted]' WHERE worker_id=? AND org_id=? AND site_id=?")
        .run(legacy.worker_id,legacy.org_id,legacy.site_id);
      db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),legacy.org_id,legacy.site_id,'system','deletion-worker','worker.reactivation_labels.redacted',legacy.worker_id,NOW());
      return true;
    }
    const row=db.prepare(`SELECT d.* FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id AND w.active=0
      WHERE NOT EXISTS(SELECT 1 FROM worker_deletion_redactions r WHERE r.request_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM recordings r JOIN assignments a ON a.id=r.assignment_id WHERE a.worker_id=d.worker_id
        AND NOT EXISTS(SELECT 1 FROM recording_purges p WHERE p.recording_id=r.id AND p.status='complete'))
      AND NOT EXISTS(SELECT 1 FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id
        WHERE a.worker_id=d.worker_id AND e.created_at<=d.created_at AND e.status<>'expired')
      AND NOT EXISTS(SELECT 1 FROM worker_imports i WHERE i.org_id=d.org_id AND (instr(i.filename,w.code)>0 OR EXISTS(
        SELECT 1 FROM json_each(COALESCE(i.rows_json,'[]')) entry WHERE json_extract(entry.value,'$.workerId')=w.code)))
      ORDER BY d.created_at,d.id LIMIT 1`).get();
    if(!row)return false;
    const now=NOW();
    db.prepare(`UPDATE attempts SET answer_text='[Deleted]',reasons_json='{"reasons":[],"evidence":[]}'
      WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=?)`).run(row.worker_id);
    db.prepare("UPDATE help_requests SET text='[Deleted]' WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=?)").run(row.worker_id);
    db.prepare("UPDATE case_messages SET text='[Deleted]' WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=?)").run(row.worker_id);
    db.prepare("UPDATE clarifications SET reason='[Deleted]',notes='' WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=?)").run(row.worker_id);
    db.prepare("UPDATE worker_language_requests SET reason='[Deleted]' WHERE worker_id=? AND reason<>'[Deleted]'").run(row.worker_id);
    db.prepare(`UPDATE presentation_artifacts SET title=CASE WHEN title IS NULL THEN NULL ELSE '[Deleted]' END,text='[Deleted]',
      question=CASE WHEN question IS NULL THEN NULL ELSE '[Deleted]' END,updated_at=?
      WHERE worker_id=? AND status='ready' AND text<>'[Deleted]'`).run(now,row.worker_id);
    db.prepare(`UPDATE presentation_artifacts SET status='failed',title=NULL,text=NULL,question=NULL,provider=NULL,live=NULL,
      error_code='Worker deletion pending',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE worker_id=? AND status='pending'`).run(now,row.worker_id);
    db.prepare(`UPDATE answer_presentation_bindings SET presented_question='[Deleted]'
      WHERE presentation_id IN (SELECT id FROM presentation_artifacts WHERE worker_id=?) AND presented_question<>'[Deleted]'`).run(row.worker_id);
    db.prepare(`UPDATE recordings SET presented_question='[Deleted]'
      WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=?) AND presented_question IS NOT NULL AND presented_question<>'[Deleted]'`).run(row.worker_id);
    db.prepare(`UPDATE instruction_deliveries SET content_json='{"title":"[Deleted]","text":"[Deleted]"}',updated_at=?
      WHERE worker_id=? AND content_json IS NOT NULL AND json_extract(content_json,'$.title')<>'[Deleted]'`).run(now,row.worker_id);
    db.prepare('INSERT INTO worker_deletion_redactions VALUES(?,?,?,?,?)').run(row.id,row.org_id,row.site_id,row.worker_id,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),row.org_id,row.site_id,'system','deletion-worker','worker.content.redacted',row.worker_id,now);
    return true;
  });
}
