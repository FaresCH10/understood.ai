import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureCaseMessageSchema,scopedCase} from './case-messages.mjs';
import {caseMessageId,caseMessageInput} from './case-message-input.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {recordWorkerEvent} from './notification-events.mjs';
import {PreparedBundleError,translatedContent,translationCheck} from './ai/prepared-bundle.mjs';
import {inspectWav} from './audio.mjs';

const receipt=row=>({id:row.id,caseId:row.case_id,language:row.language,createdAt:row.created_at,status:row.status,deliveredAt:row.delivered_at ?? null,errorCode:row.error_code ?? null});
const fold=value=>value.trim().toLocaleLowerCase().replace(/\s+/g,' ');
const failureCode=error=>typeof error?.code==='string' && /^[a-z][a-z0-9_]{0,79}$/.test(error.code)?error.code:'provider_failed';
const prompt=text=>({title:'Follow-up',text,question:'Please reply in your own words.'});
// ponytail: in-memory cap for the local preview. PostgreSQL keeps the durable provider quota.
function requestBudget(max){let used=0;return {async beforeRequest(){if(used>=max)throw Error('budget');used+=1;return used;},async afterRequest(){}};}

export function ensureCaseFollowupSchema(db) {
  ensureCaseMessageSchema(db);
  db.exec(`CREATE TABLE IF NOT EXISTS case_followups (
    id TEXT PRIMARY KEY,org_id TEXT NOT NULL,site_id TEXT NOT NULL,case_id TEXT NOT NULL,assignment_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,actor_id TEXT NOT NULL,language TEXT NOT NULL,source_text TEXT NOT NULL,request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','processing','delivered','failed')),error_code TEXT,attempts INTEGER NOT NULL DEFAULT 0,
    lease_until TEXT,created_at TEXT NOT NULL,delivered_at TEXT
  ) STRICT;
  CREATE TABLE IF NOT EXISTS case_followup_audio (
    id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,org_id TEXT NOT NULL,site_id TEXT NOT NULL,
    language TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,duration_seconds REAL NOT NULL,wav BLOB NOT NULL
  ) STRICT;`);
}
export function followupGenerationAvailable(adapter,language) {
  return language!=='en' && !!adapter?.translate && !!adapter?.checkTranslation && !!adapter.capabilities?.textLanguages?.includes(language);
}
export function followupReceipt(db,session,caseId,id) {
  caseMessageId(id);ensureCaseFollowupSchema(db);scopedCase(db,session,caseId);
  if(session.principal_type!=='staff')throw Error('Forbidden');
  const row=db.prepare('SELECT * FROM case_followups WHERE id=? AND case_id=? AND org_id=? AND site_id=? AND actor_id=?')
    .get(id,caseId,session.org_id,session.site_id,session.principal_id);
  if(!row)throw Error('Follow-up receipt unavailable');return receipt(row);
}
export function queueCaseFollowup(db,session,caseId,input,adapter) {
  const message=caseMessageInput(input);ensureCaseFollowupSchema(db);
  return transaction(db,()=>{
    if(session.principal_type!=='staff')throw Error('Forbidden');
    const thread=scopedCase(db,session,caseId,true),old=db.prepare('SELECT * FROM case_followups WHERE id=?').get(message.id);
    if(old) {
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.case_id!==caseId || old.actor_id!==session.principal_id)throw Error('Follow-up receipt unavailable');
      if(old.request_hash!==message.hash)throw Error('Conversation request conflict');return receipt(old);
    }
    if(db.prepare('SELECT 1 FROM case_messages WHERE id=?').get(message.id))throw Error('Conversation request conflict');
    requireWritableEntitlement(db,session.org_id);
    if(thread.status!=='open' || !thread.active || thread.publication_state!=='published')throw Error('Conversation is closed');
    if(!adapter?.translate || !adapter?.checkTranslation)throw Error('Follow-up generation unavailable');
    if(!followupGenerationAvailable(adapter,thread.language))throw Error('Follow-up language unavailable');
    const now=NOW();
    db.prepare(`INSERT INTO case_followups(id,org_id,site_id,case_id,assignment_id,worker_id,actor_id,language,source_text,request_hash,status,error_code,attempts,lease_until,created_at,delivered_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'queued',NULL,0,NULL,?,NULL)`).run(message.id,session.org_id,session.site_id,caseId,thread.assignment_id,thread.worker_id,session.principal_id,thread.language,message.text,message.hash,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,session.principal_type,session.principal_id,'clarification.followup_requested',message.id,now);
    return receipt({id:message.id,case_id:caseId,language:thread.language,created_at:now,status:'queued',delivered_at:null,error_code:null});
  });
}
export function getFollowupAudio(db,session,caseId,messageId) {
  caseMessageId(messageId);ensureCaseFollowupSchema(db);scopedCase(db,session,caseId);
  const message=db.prepare('SELECT text,language FROM case_messages WHERE id=? AND case_id=? AND org_id=? AND site_id=?').get(messageId,caseId,session.org_id,session.site_id);
  const row=message && db.prepare('SELECT wav,sha256,bytes,duration_seconds FROM case_followup_audio WHERE request_id=? AND org_id=? AND site_id=? AND language=?')
    .get(messageId,session.org_id,session.site_id,message.language);
  if(!message || message.text==='[Deleted]' || !row)throw Error('Follow-up audio unavailable');
  const wav=Buffer.from(row.wav);let info;try{info=inspectWav(wav);}catch{throw Error('Follow-up audio unavailable');}
  if(info.sha256!==row.sha256 || info.bytes!==row.bytes || info.durationSeconds!==row.duration_seconds)throw Error('Follow-up audio unavailable');
  return wav;
}
function deliver(db,job,text,audio=null) {
  return transaction(db,()=>{
    const current=db.prepare("SELECT * FROM case_followups WHERE id=? AND status='processing'").get(job.id);
    if(!current)return false;
    if(db.prepare('SELECT 1 FROM case_messages WHERE id=?').get(job.id)) {
      db.prepare("UPDATE case_followups SET status='delivered',delivered_at=?,lease_until=NULL,error_code=NULL WHERE id=?").run(NOW(),job.id);return true;
    }
    const actor=db.prepare('SELECT role FROM staff WHERE id=? AND org_id=? AND site_id=?').get(job.actor_id,job.org_id,job.site_id);
    const thread=scopedCase(db,{principal_type:'staff',principal_id:job.actor_id,org_id:job.org_id,site_id:job.site_id,role:actor?.role},job.case_id,true);
    if(thread.status!=='open' || !thread.active || thread.publication_state!=='published' || thread.language!==job.language || thread.assignment_id!==job.assignment_id) {
      const error=Error('interrupted');error.code='interrupted';throw error;
    }
    const now=NOW();
    db.prepare('INSERT INTO case_messages VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(job.id,job.org_id,job.site_id,job.case_id,job.assignment_id,'staff',job.actor_id,job.language,text,job.request_hash,now);
    if(audio)db.prepare('INSERT INTO case_followup_audio(id,request_id,org_id,site_id,language,sha256,bytes,duration_seconds,wav) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(),job.id,job.org_id,job.site_id,job.language,audio.info.sha256,audio.info.bytes,audio.info.durationSeconds,audio.wav);
    const auditId=randomUUID();
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(auditId,job.org_id,job.site_id,'staff',job.actor_id,'clarification.message',job.id,now);
    recordWorkerEvent(db,{orgId:job.org_id,siteId:job.site_id,workerId:job.worker_id,kind:'clarification.followup',objectType:'case_message',objectId:job.id,dedupeKey:`clarification.followup:${job.id}`,now});
    db.prepare("UPDATE case_followups SET status='delivered',delivered_at=?,lease_until=NULL,error_code=NULL WHERE id=?").run(now,job.id);
    return true;
  });
}
export async function processOneCaseFollowup(db,adapter) {
  if(!adapter)return false;ensureCaseFollowupSchema(db);
  const now=NOW();
  const job=transaction(db,()=>{
    db.prepare("UPDATE case_followups SET status='queued',lease_until=NULL WHERE status='processing' AND lease_until<=? AND attempts<3").run(now);
    db.prepare("UPDATE case_followups SET status='failed',error_code='interrupted',lease_until=NULL WHERE status='processing' AND lease_until<=? AND attempts>=3").run(now);
    const row=db.prepare("SELECT * FROM case_followups WHERE status='queued' ORDER BY created_at,id LIMIT 1").get();
    if(!row)return null;
    db.prepare("UPDATE case_followups SET status='processing',attempts=attempts+1,lease_until=? WHERE id=?").run(new Date(Date.now()+180000).toISOString(),row.id);
    return row;
  });
  if(!job)return false;
  try {
    if(db.prepare('SELECT 1 FROM case_messages WHERE id=?').get(job.id)){deliver(db,job,job.source_text);return true;}
    const speaks=typeof adapter.speech==='function' && !!adapter.capabilities?.speechLanguages?.includes(job.language);
    const client=typeof adapter.withJournal==='function'?adapter.withJournal(requestBudget(speaks?3:2)):adapter;
    const source=prompt(job.source_text);
    const translated=await client.translate(source,job.language,{terms:[]});
    const target=translatedContent(translated,job.language);
    if(target.text.length>1000 || fold(target.text)===fold(job.source_text))throw new PreparedBundleError('invalid_translation');
    translationCheck(await client.checkTranslation(source,target,job.language,{terms:[]}));
    let audio=null;
    if(speaks){
      const wav=Buffer.from(await client.speech(target.text,job.language));
      const info=inspectWav(wav);
      if(info.durationSeconds<0.25)throw new PreparedBundleError('invalid_audio');
      audio={wav,info};
    }
    deliver(db,job,target.text,audio);
  }catch(error) {
    db.prepare("UPDATE case_followups SET status='failed',error_code=?,lease_until=NULL WHERE id=? AND status='processing'").run(failureCode(error),job.id);
  }
  return true;
}
