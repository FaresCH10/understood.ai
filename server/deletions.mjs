import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {deletionInput,deletionFilters} from './deletion-input.mjs';
import {applicationCleanupEvidence} from './deletion-scope.mjs';
import {ensureRecordingSchema} from './recordings.mjs';
import {ensureDeletionRedactionSchema} from './deletion-redactions.mjs';
import {ensureNotificationEventSchema} from './notification-event-schema.mjs';

export function ensureDeletionSchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS worker_deletion_requests (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL,site_id TEXT NOT NULL,worker_id TEXT NOT NULL UNIQUE REFERENCES workers(id),
    actor_id TEXT NOT NULL REFERENCES staff(id),fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
    reason TEXT NOT NULL CHECK(reason IN ('worker_request','customer_policy')),created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS worker_deletion_completions (
    request_id TEXT PRIMARY KEY REFERENCES worker_deletion_pseudonyms(request_id),org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    worker_id TEXT NOT NULL UNIQUE REFERENCES workers(id),completed_at TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS worker_deletion_completion_scope BEFORE INSERT ON worker_deletion_completions WHEN
    NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.request_id=NEW.request_id AND p.worker_id=NEW.worker_id
      AND p.org_id=NEW.org_id AND p.site_id=NEW.site_id)
    BEGIN SELECT RAISE(ABORT,'Deletion completion scope mismatch'); END;
  CREATE TABLE IF NOT EXISTS worker_deletion_pseudonyms (
    request_id TEXT PRIMARY KEY REFERENCES worker_deletion_requests(id),org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    worker_id TEXT NOT NULL UNIQUE REFERENCES workers(id),code_hash TEXT NOT NULL CHECK(length(code_hash)=64),
    pseudonym TEXT NOT NULL UNIQUE,completed_at TEXT NOT NULL,UNIQUE(org_id,code_hash),
    FOREIGN KEY(request_id) REFERENCES worker_deletion_redactions(request_id)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS worker_pseudonym_scope BEFORE INSERT ON worker_deletion_pseudonyms WHEN
    NOT EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id
      WHERE d.id=NEW.request_id AND d.worker_id=NEW.worker_id AND d.org_id=NEW.org_id AND d.site_id=NEW.site_id
      AND w.active=0 AND (sha256(w.code)=NEW.code_hash OR w.code=NEW.pseudonym))
    BEGIN SELECT RAISE(ABORT,'Pseudonym scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS deleted_worker_identity_fence BEFORE UPDATE ON workers WHEN
    EXISTS(SELECT 1 FROM worker_deletion_requests WHERE worker_id=OLD.id) AND
    (NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id OR NEW.language IS NOT OLD.language
      OR (NEW.code IS NOT OLD.code AND NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.worker_id=OLD.id AND p.pseudonym=NEW.code))
      OR (NEW.name IS NOT OLD.name AND NOT (NEW.name IS NULL AND EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.worker_id=OLD.id))))
    BEGIN SELECT RAISE(ABORT,'Worker deletion pending'); END;
  CREATE TRIGGER IF NOT EXISTS worker_deletion_scope BEFORE INSERT ON worker_deletion_requests WHEN
    NOT EXISTS(SELECT 1 FROM workers WHERE id=NEW.worker_id AND org_id=NEW.org_id AND site_id=NEW.site_id AND active=0)
    OR NOT EXISTS(SELECT 1 FROM staff WHERE id=NEW.actor_id AND org_id=NEW.org_id AND site_id=NEW.site_id AND active=1 AND role IN ('owner','administrator'))
    BEGIN SELECT RAISE(ABORT,'Deletion scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS worker_deletion_access_fence BEFORE UPDATE ON workers WHEN NEW.active<>0
    AND EXISTS(SELECT 1 FROM worker_deletion_requests WHERE worker_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Worker deletion pending'); END;`);
  for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS worker_deletion_frozen_${action.toLowerCase()}
    BEFORE ${action} ON worker_deletion_requests BEGIN SELECT RAISE(ABORT,'Deletion receipt is immutable'); END;`);
  for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS worker_pseudonym_frozen_${action.toLowerCase()}
    BEFORE ${action} ON worker_deletion_pseudonyms BEGIN SELECT RAISE(ABORT,'Pseudonym receipt is immutable'); END;`);
  for(const action of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS worker_deletion_completion_frozen_${action.toLowerCase()}
    BEFORE ${action} ON worker_deletion_completions BEGIN SELECT RAISE(ABORT,'Deletion completion is immutable'); END;`);
  for(const action of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER IF NOT EXISTS worker_code_reserved_${action.toLowerCase()}
    BEFORE ${action} ON workers WHEN EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.org_id=NEW.org_id AND p.code_hash=sha256(NEW.code))
    BEGIN SELECT RAISE(ABORT,'Worker code unavailable'); END;`);
}

function authority(db,session){
    if(session?.principal_type!=='staff' || !['owner','administrator'].includes(session.role)
      || !db.prepare('SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1')
        .get(session.principal_id,session.org_id,session.site_id,session.role))throw new Error('Forbidden');
    if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=?
      AND principal_type='staff' AND principal_id=? AND revoked_at IS NULL AND expires_at>?`)
      .get(session.token_hash,session.org_id,session.site_id,session.principal_id,NOW()))throw new Error('Sign in required');
}

export function listPrivacyWorkers(db,session,filters={}){
  const {page,pageSize,search,status}=deletionFilters(filters);ensureDeletionSchema(db);
  return transaction(db,()=>{
    authority(db,session);
    const from=`FROM workers w LEFT JOIN worker_deletion_requests d ON d.worker_id=w.id
      LEFT JOIN worker_deletion_completions c ON c.request_id=d.id`;
    const state="CASE WHEN c.request_id IS NOT NULL THEN 'complete' WHEN d.id IS NOT NULL THEN 'queued' ELSE 'none' END";
    const where=`WHERE w.org_id=? AND w.site_id=? AND (?='' OR instr(lower(w.code),lower(?))>0 OR instr(lower(w.id),lower(?))>0)
      AND (?='all' OR ${state}=?)`;
    const values=[session.org_id,session.site_id,search,search,search,status,status];
    const total=db.prepare(`SELECT count(*) AS count ${from} ${where}`).get(...values).count;
    const items=db.prepare(`SELECT w.id,w.code,w.active,${state} AS deletion_status,d.created_at AS requested_at,c.completed_at
      ${from} ${where} ORDER BY w.code COLLATE NOCASE,w.id LIMIT ? OFFSET ?`).all(...values,pageSize,(page-1)*pageSize)
      .map(row=>({...row,active:!!row.active,cleanupEvidence:applicationCleanupEvidence()}));
    return {items,total,page,pageSize};
  });
}

export function getWorkerDeletion(db,session,workerId){
  if(typeof workerId!=='string' || !workerId || workerId.length>100)throw new Error('Invalid deletion request');
  ensureDeletionRedactionSchema(db);authority(db,session);
  if(!db.prepare('SELECT 1 FROM workers WHERE id=? AND org_id=? AND site_id=?').get(workerId,session.org_id,session.site_id))throw new Error('Worker unavailable');
  const row=db.prepare(`SELECT d.id,d.worker_id,d.reason,d.created_at,rd.completed_at AS redacted_at,p.completed_at AS pseudonymized_at,c.completed_at
    FROM worker_deletion_requests d LEFT JOIN worker_deletion_redactions rd ON rd.request_id=d.id
    LEFT JOIN worker_deletion_pseudonyms p ON p.request_id=d.id LEFT JOIN worker_deletion_completions c ON c.request_id=d.id
    WHERE d.worker_id=? AND d.org_id=? AND d.site_id=?`).get(workerId,session.org_id,session.site_id);
  return row?{id:row.id,workerId:row.worker_id,reason:row.reason,createdAt:row.created_at,completedAt:row.completed_at,
      status:row.completed_at?'complete':'queued',contentRedactedAt:row.redacted_at,identityPseudonymizedAt:row.pseudonymized_at,cleanupEvidence:applicationCleanupEvidence()}:null;
}

export function requestWorkerDeletion(db,session,workerId,input){
  const fingerprint=deletionInput(workerId,input);ensureDeletionSchema(db);ensureRecordingSchema(db);ensureNotificationEventSchema(db);
  return transaction(db,()=>{
    authority(db,session);
    const old=db.prepare('SELECT * FROM worker_deletion_requests WHERE id=?').get(input.requestId);
    if(old){
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.actor_id!==session.principal_id
        || old.worker_id!==workerId || old.fingerprint!==fingerprint)throw new Error('Deletion request conflict');
      return {id:old.id,status:db.prepare('SELECT 1 FROM worker_deletion_completions WHERE request_id=?').get(old.id)?'complete':'queued',duplicate:true,cleanupEvidence:applicationCleanupEvidence()};
    }
    const worker=db.prepare('SELECT * FROM workers WHERE id=? AND org_id=? AND site_id=?').get(workerId,session.org_id,session.site_id);
    if(!worker)throw new Error('Worker unavailable');
    if(worker.code!==input.expectedCode)throw new Error('Worker code changed');
    if(db.prepare('SELECT 1 FROM worker_deletion_requests WHERE worker_id=?').get(workerId))throw new Error('Worker deletion pending');
    const now=NOW();
    db.prepare('UPDATE workers SET active=0 WHERE id=?').run(workerId);
    db.prepare('INSERT INTO worker_deletion_requests VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,workerId,session.principal_id,fingerprint,input.reason,now);
    db.prepare('UPDATE worker_grants SET revoked_at=? WHERE worker_id=? AND revoked_at IS NULL').run(now,workerId);
    db.prepare('UPDATE worker_setup_tokens SET revoked_at=? WHERE worker_id=? AND revoked_at IS NULL').run(now,workerId);
    db.prepare(`UPDATE push_subscriptions SET revoked_at=?,revoke_reason='worker_deleted',updated_at=?
      WHERE principal_type='worker' AND principal_id=? AND revoked_at IS NULL`).run(now,now,workerId);
    db.prepare(`UPDATE push_deliveries SET state='cancelled',last_error='worker_deleted',updated_at=?
      WHERE state IN ('queued','sending') AND subscription_id IN (SELECT id FROM push_subscriptions
        WHERE principal_type='worker' AND principal_id=?)`).run(now,workerId);
    db.prepare("UPDATE sessions SET revoked_at=? WHERE principal_type='worker' AND principal_id=? AND revoked_at IS NULL").run(now,workerId);
    db.prepare(`UPDATE recordings SET status='failed',transcript=NULL,lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Worker deletion pending'
      WHERE status<>'storing' AND assignment_id IN (SELECT id FROM assignments WHERE worker_id=?)`).run(workerId);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,'worker.deletion.requested',workerId,now);
    return {id:input.requestId,status:'queued',duplicate:false,cleanupEvidence:applicationCleanupEvidence()};
  });
}
