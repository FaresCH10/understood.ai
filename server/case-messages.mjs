import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureClarificationSchema,requireClarificationPrincipal} from './clarifications.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {caseMessageId,caseMessageInput,caseMessageFilters,caseMessageReceipt,caseMessageRow} from './case-message-input.mjs';
import {sqlLanguageList} from './languages.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {recordStaffPushEvent,recordWorkerEvent} from './notification-events.mjs';

export function ensureCaseMessageSchema(db) {
  ensureClarificationSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS case_messages (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL,site_id TEXT NOT NULL,case_id TEXT NOT NULL REFERENCES clarifications(id),
    assignment_id TEXT NOT NULL REFERENCES assignments(id),actor_type TEXT NOT NULL CHECK(actor_type IN ('staff','worker')),
    actor_id TEXT NOT NULL,language TEXT NOT NULL CHECK(language IN (${sqlLanguageList()})),text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 1000),
    request_hash TEXT NOT NULL CHECK(length(request_hash)=64),created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS case_messages_thread ON case_messages(case_id,created_at,id);
  CREATE TRIGGER IF NOT EXISTS case_message_scope BEFORE INSERT ON case_messages WHEN
    NOT EXISTS(SELECT 1 FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
      WHERE c.id=NEW.case_id AND c.org_id=NEW.org_id AND a.site_id=NEW.site_id AND a.id=NEW.assignment_id AND a.language=NEW.language)
    OR (NEW.actor_type='staff' AND NOT EXISTS(SELECT 1 FROM staff s WHERE s.id=NEW.actor_id AND s.org_id=NEW.org_id AND s.site_id=NEW.site_id))
    OR (NEW.actor_type='worker' AND NOT EXISTS(SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.worker_id=NEW.actor_id))
    OR EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=NEW.assignment_id)
    BEGIN SELECT RAISE(ABORT,'Conversation scope mismatch'); END;
  CREATE TRIGGER IF NOT EXISTS case_message_frozen_update BEFORE UPDATE ON case_messages WHEN
    NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id OR NEW.case_id IS NOT OLD.case_id
    OR NEW.assignment_id IS NOT OLD.assignment_id OR NEW.actor_type IS NOT OLD.actor_type OR NEW.actor_id IS NOT OLD.actor_id
    OR NEW.language IS NOT OLD.language OR NEW.request_hash IS NOT OLD.request_hash OR NEW.created_at IS NOT OLD.created_at
    OR NEW.text<>'[Deleted]' OR NOT EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=OLD.assignment_id)
    BEGIN SELECT RAISE(ABORT,'Conversation evidence is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS case_message_frozen_delete BEFORE DELETE ON case_messages
    BEGIN SELECT RAISE(ABORT,'Conversation evidence is immutable'); END;`);
}

export function scopedCase(db,session,id,write=false) {
  caseMessageId(id);const type=session?.principal_type;
  if(!['staff','worker'].includes(type))throw Error('Forbidden');
  requireClarificationPrincipal(db,session,type,write);
  if(write)requireSiteOperational(db,session.org_id,session.site_id);
  const row=db.prepare(`SELECT c.id,c.status,a.id AS assignment_id,a.worker_id,a.language,w.active,p.state AS publication_state
    FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE c.id=? AND c.org_id=? AND a.site_id=? ${type==='worker'?'AND a.worker_id=?':''}`)
    .get(id,session.org_id,session.site_id,...(type==='worker'?[session.principal_id]:[]));
  if(!row)throw Error('Clarification unavailable');return row;
}
function exactReceipt(db,session,caseId,id) {
  const row=db.prepare('SELECT * FROM case_messages WHERE id=? AND case_id=? AND org_id=? AND site_id=? AND actor_type=? AND actor_id=?')
    .get(id,caseId,session.org_id,session.site_id,session.principal_type,session.principal_id);
  if(!row)throw Error('Conversation receipt unavailable');return row;
}
export function caseMessageReceiptLookup(db,session,caseId,id) {
  caseMessageId(id);scopedCase(db,session,caseId);return caseMessageReceipt(exactReceipt(db,session,caseId,id));
}
export function listCaseMessages(db,session,caseId,filters={}) {
  const {page,pageSize}=caseMessageFilters(filters),thread=scopedCase(db,session,caseId);
  const total=db.prepare('SELECT count(*) n FROM case_messages WHERE case_id=? AND org_id=? AND site_id=?').get(caseId,session.org_id,session.site_id).n;
  const rows=db.prepare(`SELECT m.*,s.name AS author_name FROM case_messages m LEFT JOIN staff s ON s.id=m.actor_id AND m.actor_type='staff'
    AND s.org_id=m.org_id AND s.site_id=m.site_id WHERE m.case_id=? AND m.org_id=? AND m.site_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT ? OFFSET ?`)
    .all(caseId,session.org_id,session.site_id,pageSize,(page-1)*pageSize);
  const spoken=new Set(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='case_followup_audio'").get() && rows.length
    ? db.prepare(`SELECT request_id FROM case_followup_audio WHERE org_id=? AND site_id=? AND request_id IN (${rows.map(()=>'?').join(',')})`).all(session.org_id,session.site_id,...rows.map(row=>row.id)).map(row=>row.request_id) : []);
  return {items:rows.map(row=>({...caseMessageRow(row),...(spoken.has(row.id)?{audioUrl:`/api/clarifications/${caseId}/messages/${row.id}/audio`}:{})})),total,page,pageSize,status:thread.status,language:thread.language,canReply:thread.status==='open' && !!thread.active && thread.publication_state==='published'};
}
export function sendCaseMessage(db,session,caseId,input) {
  const message=caseMessageInput(input);
  return transaction(db,()=>{
    const thread=scopedCase(db,session,caseId,true),old=db.prepare('SELECT * FROM case_messages WHERE id=?').get(message.id);
    if(old) {
      const exact=exactReceipt(db,session,caseId,message.id);
      if(exact.request_hash!==message.hash)throw Error('Conversation request conflict');return caseMessageReceipt(exact);
    }
    requireWritableEntitlement(db,session.org_id);
    if(thread.status!=='open' || !thread.active || thread.publication_state!=='published')throw Error('Conversation is closed');
    // Never deliver untranslated English as if it were the worker's frozen language.
    if(session.principal_type==='staff' && thread.language!=='en')throw Error('Follow-up translation unavailable');
    const now=NOW();
    db.prepare('INSERT INTO case_messages VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(message.id,session.org_id,session.site_id,caseId,thread.assignment_id,session.principal_type,session.principal_id,thread.language,message.text,message.hash,now);
    const auditId=randomUUID();
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(auditId,session.org_id,session.site_id,session.principal_type,session.principal_id,'clarification.message',message.id,now);
    if(session.principal_type==='worker')
      recordStaffPushEvent(db,{orgId:session.org_id,siteId:session.site_id,auditId,action:'clarification.message',objectId:message.id,now});
    else recordWorkerEvent(db,{orgId:session.org_id,siteId:session.site_id,workerId:thread.worker_id,
      kind:'clarification.followup',objectType:'case_message',objectId:message.id,dedupeKey:`clarification.followup:${message.id}`,now});
    return caseMessageReceipt({id:message.id,case_id:caseId,language:thread.language,created_at:now});
  });
}
