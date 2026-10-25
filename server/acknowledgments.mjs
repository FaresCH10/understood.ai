import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';

const uuid=(value)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function ensureAcknowledgementSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS acknowledgments (
    request_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    assignment_id TEXT NOT NULL UNIQUE REFERENCES assignments(id),
    worker_id TEXT NOT NULL REFERENCES workers(id),
    received_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_acknowledgments_org_time ON acknowledgments(org_id,received_at);
  CREATE TRIGGER IF NOT EXISTS acknowledgment_scope BEFORE INSERT ON acknowledgments
    WHEN NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id
      AND a.site_id=NEW.site_id AND a.worker_id=NEW.worker_id)
    BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS acknowledgment_frozen_update BEFORE UPDATE ON acknowledgments
    BEGIN SELECT RAISE(ABORT,'Acknowledgment is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS acknowledgment_frozen_delete BEFORE DELETE ON acknowledgments
    BEGIN SELECT RAISE(ABORT,'Acknowledgment is immutable'); END;`);
}

export function acknowledgeAssignment(db,session,assignmentId,requestId) {
  if(session?.principal_type!=='worker') throw new Error('Forbidden');
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100 || !uuid(requestId))
    throw new Error('Invalid acknowledgment request');
  ensureAcknowledgementSchema(db);
  return transaction(db,()=>{
    requireWorkerSiteAccess(db,session.org_id,session.site_id);
    if(!db.prepare('SELECT 1 FROM workers WHERE id=? AND org_id=? AND site_id=? AND active=1')
      .get(session.principal_id,session.org_id,session.site_id)) throw new Error('Forbidden');
    const assignment=db.prepare(`SELECT a.id,a.due_at,p.state,p.snapshot_json FROM assignments a
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`)
      .get(assignmentId,session.org_id,session.site_id,session.principal_id);
    if(!assignment) throw new Error('Assignment unavailable');
    const old=db.prepare('SELECT request_id,received_at FROM acknowledgments WHERE assignment_id=? AND org_id=?')
      .get(assignmentId,session.org_id);
    if(old) return {id:old.request_id,receivedAt:old.received_at,duplicate:true};
    requireWritableEntitlement(db,session.org_id);
    let snapshot;
    try{snapshot=JSON.parse(assignment.snapshot_json);}catch{throw new Error('Assignment unavailable');}
    if(snapshot.responseMode!=='acknowledge') throw new Error('This instruction requires an answer');
    if(assignment.state!=='published') throw new Error('Assignment unavailable');
    if(assignment.due_at && assignment.due_at<=NOW()) throw new Error('Assignment deadline passed');
    const now=NOW();
    db.prepare('INSERT INTO acknowledgments VALUES(?,?,?,?,?,?)')
      .run(requestId,session.org_id,session.site_id,assignmentId,session.principal_id,now);
    db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(),session.org_id,session.site_id,'worker',session.principal_id,'instruction.acknowledged',assignmentId,now);
    return {id:requestId,receivedAt:now,duplicate:false};
  });
}
