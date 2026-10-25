import { randomUUID } from 'node:crypto';
import { NOW,transaction } from './db.mjs';
import { helpInput,clarificationFilters,resolutionInput,ownerInput,workerHelpHistoryInput } from './clarification-input.mjs';
import {ensureDeletionSchema} from './deletions.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {ensureCaseRoutingSchema,routeNewCase} from './case-routing.mjs';
import {ensureClarificationActionSchema} from './clarification-action-schema.mjs';
import {clarificationActionCommand,clarificationActionId,clarificationCaseId,clarificationActionReceiptRow,exactClarificationAction} from './clarification-action-input.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {ensureClarificationCreationSchema} from './clarification-create-schema.mjs';
import {workerCredentialSessionValid} from './auth.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {recordStaffPushEvent} from './notification-events.mjs';

function authority(db,session,type='staff',write=false) {
  if (session?.principal_type!==type || (type==='staff' && !(write ? ['owner','supervisor'] : ['owner','supervisor','auditor']).includes(session.role))) throw new Error('Forbidden');
  if(type==='worker')requireWorkerSiteAccess(db,session.org_id,session.site_id);
  const principal=db.prepare(`SELECT id FROM ${type==='staff' ? 'staff' : 'workers'} WHERE id=? AND org_id=? AND site_id=? AND active=1 ${type==='staff' ? 'AND role=?' : ''}`)
    .get(session.principal_id,session.org_id,session.site_id,...(type==='staff' ? [session.role] : []));
  if (!principal) throw new Error('Forbidden');
  if (type==='worker' && session.access_mode==='credential' && !workerCredentialSessionValid(db, session)) throw new Error('Forbidden');
}
export {authority as requireClarificationPrincipal};

export function ensureClarificationSchema(db) {
  ensureDeletionSchema(db);
  ensureCaseRoutingSchema(db);
  for(const name of ['help_frozen_update','clarification_identity','clarification_resolved']){
    const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
    if(trigger && !trigger.sql.includes('worker_deletion_requests'))db.exec(`DROP TRIGGER ${name}`);
  }
  const deleted=`EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=OLD.assignment_id)`;
  transaction(db,() => {
    ensureClarificationActionSchema(db);
    ensureClarificationCreationSchema(db);
    db.exec(`CREATE TABLE IF NOT EXISTS help_requests (
      case_id TEXT PRIMARY KEY REFERENCES clarifications(id), org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), assignment_id TEXT NOT NULL REFERENCES assignments(id),
      text TEXT NOT NULL CHECK(length(trim(text)) BETWEEN 3 AND 500), created_at TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS help_scope_insert BEFORE INSERT ON help_requests
      WHEN NOT EXISTS(SELECT 1 FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
        WHERE c.id=NEW.case_id AND c.org_id=NEW.org_id AND c.assignment_id=NEW.assignment_id AND a.site_id=NEW.site_id)
      BEGIN SELECT RAISE(ABORT,'Scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS help_frozen_update BEFORE UPDATE ON help_requests WHEN
      NEW.case_id IS NOT OLD.case_id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
      OR NEW.assignment_id IS NOT OLD.assignment_id OR NEW.created_at IS NOT OLD.created_at OR NEW.text<>'[Deleted]' OR NOT ${deleted}
      BEGIN SELECT RAISE(ABORT,'Help evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS help_frozen_delete BEFORE DELETE ON help_requests BEGIN SELECT RAISE(ABORT,'Help evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS clarification_identity BEFORE UPDATE ON clarifications
      WHEN NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.assignment_id IS NOT OLD.assignment_id
        OR NEW.attempt_id IS NOT OLD.attempt_id OR (NEW.reason IS NOT OLD.reason AND NOT (NEW.reason='[Deleted]' AND ${deleted})) OR NEW.created_at IS NOT OLD.created_at
      BEGIN SELECT RAISE(ABORT,'Clarification evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS clarification_resolved BEFORE UPDATE ON clarifications
      WHEN OLD.status='resolved' AND (NEW.status IS NOT OLD.status OR (NEW.notes IS NOT OLD.notes AND NOT (NEW.notes='' AND ${deleted})) OR NEW.owner_staff_id IS NOT OLD.owner_staff_id)
      BEGIN SELECT RAISE(ABORT,'Resolved clarification is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS clarification_deletion_fence BEFORE UPDATE ON clarifications
      WHEN ${deleted} AND (NEW.reason<>'[Deleted]' OR NEW.notes<>'')
      BEGIN SELECT RAISE(ABORT,'Deleted content is immutable'); END;`);
    // Only still-open legacy cases have known original worker text; resolved overwritten text cannot be recovered.
    db.prepare(`INSERT OR IGNORE INTO help_requests(case_id,org_id,site_id,assignment_id,text,created_at)
      SELECT c.id,c.org_id,a.site_id,c.assignment_id,trim(c.notes),c.created_at FROM clarifications c
      JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      WHERE c.attempt_id IS NULL AND c.reason='Help requested' AND c.status='open' AND length(trim(c.notes)) BETWEEN 3 AND 500`).run();
  });
}

function audit(db,session,action,id) {
  const auditId=randomUUID();
  db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(auditId,session.org_id,session.site_id,session.principal_type,session.principal_id,action,id,NOW());
  recordStaffPushEvent(db,{orgId:session.org_id,siteId:session.site_id,auditId,action,objectId:id});
}

const caseQuery=`SELECT c.id,c.reason,c.status,c.notes,c.created_at,c.owner_staff_id,c.assignment_id,c.attempt_id,
  w.code AS worker,a.language,a.due_at,r.due_at AS case_due_at,r.escalated_at,p.id AS publication_id,p.version,json_extract(p.snapshot_json,'$.title') AS title,s.name AS owner_name
  FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
  JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
  JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
  LEFT JOIN staff s ON s.id=c.owner_staff_id AND s.org_id=c.org_id AND s.site_id=a.site_id
  LEFT JOIN case_routing r ON r.case_id=c.id AND r.org_id=c.org_id AND r.site_id=a.site_id`;

function scopedCase(db,session,id) {
  const row=db.prepare(`${caseQuery} WHERE c.id=? AND c.org_id=? AND a.site_id=?`).get(id,session.org_id,session.site_id);
  if (!row) throw new Error('Clarification unavailable');
  return row;
}

export function listClarifications(db,session,filters={}) {
  return transaction(db,()=>{
  authority(db,session);
  const {search,status,owner,overdue,page,pageSize}=clarificationFilters(filters);
  const args=[session.org_id,session.site_id],where=['c.org_id=?','a.site_id=?'];
  if (status!=='all') {where.push('c.status=?'); args.push(status);}
  if (owner==='unassigned') where.push('c.owner_staff_id IS NULL');
  else if (owner!=='all') {where.push('c.owner_staff_id=?'); args.push(owner==='mine' ? session.principal_id : owner);}
  if (overdue==='true') {where.push("c.status='open' AND COALESCE(r.due_at,a.due_at)<?"); args.push(NOW());}
  if (overdue==='false') {where.push("(c.status='resolved' OR COALESCE(r.due_at,a.due_at) IS NULL OR COALESCE(r.due_at,a.due_at)>=?)"); args.push(NOW());}
  if (search) {where.push("instr(lower(w.code||' '||c.reason||' '||COALESCE(json_extract(p.snapshot_json,'$.title'),'')),lower(?))>0"); args.push(search);}
  const rows=db.prepare(`${caseQuery} WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT 5001`).all(...args);
  if (rows.length>5000) throw new Error('Clarifications exceed limit; narrow filters');
  const ownerOptions=db.prepare(`SELECT s.id,s.name FROM staff s WHERE s.org_id=? AND s.site_id=?
    AND ((s.active=1 AND s.role IN ('owner','supervisor')) OR EXISTS(SELECT 1 FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      WHERE c.owner_staff_id=s.id AND c.org_id=s.org_id AND a.site_id=s.site_id)) ORDER BY s.name,s.id LIMIT 5001`).all(session.org_id,session.site_id);
  if(ownerOptions.length>5000)throw Error('Clarification owners exceed limit');
  return {rows:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length,page,pageSize,ownerOptions};
  });
}

export function getClarification(db,session,id) {
  authority(db,session);
  const row=scopedCase(db,session,id);
  const snapshot=JSON.parse(db.prepare('SELECT snapshot_json FROM publications WHERE id=? AND org_id=? AND site_id=?').get(row.publication_id,session.org_id,session.site_id).snapshot_json);
  const original=row.attempt_id ? db.prepare(`SELECT t.answer_text,t.outcome,t.reasons_json,r.id AS recording_id FROM attempts t
    LEFT JOIN recordings r ON r.assignment_id=t.assignment_id AND r.org_id=t.org_id AND r.submission_id=t.submission_id AND r.received_at IS NOT NULL
    WHERE t.id=? AND t.assignment_id=? AND t.org_id=?`).get(row.attempt_id,row.assignment_id,session.org_id) : null;
  const help=db.prepare('SELECT text,created_at FROM help_requests WHERE case_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
  const attempts=db.prepare(`SELECT t.id,t.answer_text,t.outcome,t.reasons_json,t.received_at,r.id AS recording_id FROM attempts t
    LEFT JOIN recordings r ON r.assignment_id=t.assignment_id AND r.org_id=t.org_id AND r.submission_id=t.submission_id AND r.received_at IS NOT NULL
    WHERE t.assignment_id=? AND t.org_id=? ORDER BY t.received_at DESC,t.id DESC LIMIT 100`).all(row.assignment_id,session.org_id);
  const owners=db.prepare("SELECT id,name FROM staff WHERE org_id=? AND site_id=? AND active=1 AND role IN ('owner','supervisor') ORDER BY name,id LIMIT 5001").all(session.org_id,session.site_id);
  if(owners.length>5000)throw Error('Clarification owners exceed limit');
  const creation=db.prepare(`SELECT cr.actor_id AS actorId,s.name AS actorName,cr.created_at AS createdAt FROM clarification_creations cr JOIN staff s ON s.id=cr.actor_id AND s.org_id=cr.org_id AND s.site_id=cr.site_id WHERE cr.case_id=? AND cr.org_id=? AND cr.site_id=?`).get(id,session.org_id,session.site_id);
  return {...row,...original,...(creation?{staffCreation:creation}:{}),notes:help && row.status==='open' && row.notes===help.text ? '' : row.notes,snapshot,attempts,owners,helpRequest:help ? {text:help.text,createdAt:help.created_at} : null};
}

export function requestHelp(db,session,assignmentId,input) {
  const {requestId,text}=helpInput(assignmentId,input);
  return transaction(db,() => {
    authority(db,session,'worker');
    const assignment=db.prepare('SELECT id,publication_id FROM assignments WHERE id=? AND org_id=? AND site_id=? AND worker_id=?').get(assignmentId,session.org_id,session.site_id,session.principal_id);
    if (!assignment) throw new Error('Assignment unavailable');
    const old=db.prepare('SELECT h.*,c.status FROM help_requests h JOIN clarifications c ON c.id=h.case_id AND c.org_id=h.org_id WHERE h.case_id=?').get(requestId);
    if (old) {
      if (old.org_id!==session.org_id || old.site_id!==session.site_id || old.assignment_id!==assignmentId || old.text!==text) throw new Error('Help request conflict');
      return {id:requestId,status:old.status,duplicate:true};
    }
    requireWritableEntitlement(db,session.org_id);
    if (db.prepare('SELECT state FROM publications WHERE id=? AND org_id=? AND site_id=?').get(assignment.publication_id,session.org_id,session.site_id)?.state!=='published') throw new Error('Assignment unavailable');
    if (db.prepare('SELECT 1 FROM clarifications WHERE id=?').get(requestId)) throw new Error('Help request conflict');
    const now=NOW();
    db.prepare('INSERT INTO clarifications VALUES(?,?,?,?,?,?,?,?,?)').run(requestId,session.org_id,assignmentId,null,'Help requested',null,'open','',now);
    db.prepare('INSERT INTO help_requests VALUES(?,?,?,?,?,?)').run(requestId,session.org_id,session.site_id,assignmentId,text,now);
    routeNewCase(db,session.org_id,session.site_id,requestId);
    audit(db,session,'help.requested',requestId);
    return {id:requestId,status:'open',duplicate:false};
  });
}

export function resolveClarification(db,session,id,input) {
  const command=clarificationActionCommand('resolve',input),notes=resolutionInput(command?{notes:command.content.notes}:input);
  if(command&&!clarificationCaseId(id))throw Error('Invalid clarification action');
  return transaction(db,() => {
    authority(db,session,'staff',true);
    if(command){const old=previousAction(db,session,id,command);if(old)return old;requireSiteOperational(db,session.org_id,session.site_id);}
    const row=scopedCase(db,session,id);
    if (row.status==='resolved') {
      if(command)return recordAction(db,session,row,command,row.notes===notes?'unchanged':'rejected',row.notes===notes?null:'resolution_conflict');
      if (row.notes!==notes) throw new Error('Resolution conflict');
      return {id,status:'resolved',duplicate:true};
    }
    db.prepare("UPDATE clarifications SET status='resolved',notes=? WHERE id=? AND org_id=?").run(notes,id,session.org_id);
    audit(db,session,'clarification.resolved',id);
    return command?recordAction(db,session,{...row,status:'resolved'},command,'applied'):{id,status:'resolved',duplicate:false};
  });
}

export function assignClarification(db,session,id,input) {
  const command=clarificationActionCommand('assign',input),ownerId=ownerInput(command?{ownerId:command.content.ownerId}:input);
  if(command&&!clarificationCaseId(id))throw Error('Invalid clarification action');
  return transaction(db,() => {
    authority(db,session,'staff',true);
    if(command){const old=previousAction(db,session,id,command);if(old)return old;requireSiteOperational(db,session.org_id,session.site_id);}
    const row=scopedCase(db,session,id);
    if(command){
      if(row.owner_staff_id===ownerId)return recordAction(db,session,row,command,'unchanged');
      if(row.status==='resolved')return recordAction(db,session,row,command,'rejected','case_resolved');
      if(row.owner_staff_id!==command.content.expectedOwnerId)return recordAction(db,session,row,command,'rejected','owner_changed');
      if(ownerId!==null&&!db.prepare("SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND active=1 AND role IN ('owner','supervisor')").get(ownerId,session.org_id,session.site_id))
        return recordAction(db,session,row,command,'rejected','owner_unavailable');
    }
    if (ownerId!==null && !db.prepare("SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND active=1 AND role IN ('owner','supervisor')").get(ownerId,session.org_id,session.site_id)) throw new Error('Clarification owner unavailable');
    if (row.owner_staff_id===ownerId) return {id,ownerId,duplicate:true};
    if (row.status==='resolved') throw new Error('Resolution conflict');
    db.prepare('UPDATE clarifications SET owner_staff_id=? WHERE id=? AND org_id=?').run(ownerId,id,session.org_id);
    db.prepare('UPDATE case_routing SET manual=1 WHERE case_id=?').run(id);
    audit(db,session,'clarification.assigned',id);
    return command?recordAction(db,session,{...row,owner_staff_id:ownerId},command,'applied'):{id,ownerId,duplicate:false};
  });
}

function previousAction(db,session,caseId,command){
  const row=db.prepare('SELECT * FROM clarification_action_receipts WHERE request_id=?').get(command.id);
  return row?exactClarificationAction(row,session,caseId,command):null;
}
function recordAction(db,session,row,command,effect,reasonCode=null){
  const createdAt=NOW();
  db.prepare(`INSERT INTO clarification_action_receipts(request_id,org_id,site_id,case_id,actor_id,actor_role,kind,request_hash,effect,result_status,result_owner_id,reason_code,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(command.id,session.org_id,session.site_id,row.id,session.principal_id,session.role,command.kind,command.hash,effect,row.status,row.owner_staff_id,reasonCode,createdAt);
  audit(db,session,'clarification.action_received',command.id);
  return clarificationActionReceiptRow(db.prepare('SELECT * FROM clarification_action_receipts WHERE request_id=?').get(command.id));
}
export function clarificationActionReceipt(db,session,caseId,requestId){
  if(!clarificationCaseId(caseId)||!clarificationActionId(requestId))throw Error('Invalid clarification action');
  return transaction(db,()=>{
    authority(db,session);scopedCase(db,session,caseId);
    return exactClarificationAction(db.prepare('SELECT * FROM clarification_action_receipts WHERE request_id=?').get(requestId),session,caseId);
  });
}

export function workerHelpHistory(db,session,assignmentId,input={}) {
  const {page,pageSize}=workerHelpHistoryInput(assignmentId,input);
  return transaction(db,()=>{
    authority(db,session,'worker');
    const assignment=db.prepare(`SELECT a.id,a.language,p.version,p.state FROM assignments a JOIN publications p
      ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`).get(assignmentId,session.org_id,session.site_id,session.principal_id);
    if(!assignment)throw new Error('Assignment unavailable');
    const total=db.prepare(`SELECT COUNT(*) AS n FROM clarifications WHERE assignment_id=? AND org_id=?`).get(assignmentId,session.org_id).n;
    const cases=db.prepare(`SELECT c.id,c.status,c.created_at AS createdAt,h.text AS helpText,s.name AS owner FROM clarifications c
      LEFT JOIN help_requests h ON h.case_id=c.id AND h.org_id=c.org_id AND h.site_id=?
      LEFT JOIN staff s ON s.id=c.owner_staff_id AND s.org_id=c.org_id AND s.site_id=?
      WHERE c.assignment_id=? AND c.org_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`)
      .all(session.site_id,session.site_id,assignmentId,session.org_id,pageSize,(page-1)*pageSize);
    return {assignment,cases,total,page,pageSize};
  });
}

export function workerHelpCases(db,session,assignmentId) {
  authority(db,session,'worker');
  if (!db.prepare('SELECT id FROM assignments WHERE id=? AND org_id=? AND site_id=? AND worker_id=?').get(assignmentId,session.org_id,session.site_id,session.principal_id)) throw new Error('Assignment unavailable');
  return db.prepare(`SELECT c.id,c.status,c.created_at AS createdAt,h.text AS helpText,s.name AS owner FROM clarifications c
    LEFT JOIN help_requests h ON h.case_id=c.id AND h.org_id=c.org_id AND h.site_id=?
    LEFT JOIN staff s ON s.id=c.owner_staff_id AND s.org_id=c.org_id AND s.site_id=?
    WHERE c.assignment_id=? AND c.org_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 100`).all(session.site_id,session.site_id,assignmentId,session.org_id);
}
