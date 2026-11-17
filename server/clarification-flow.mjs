import {clarificationDay,clarificationDateAt} from './clarification-day.mjs';
import {randomUUID} from 'node:crypto';
import {routeNewCase} from './case-routing.mjs';
import {recordWorkerEvent,staffAuditOnce} from './notification-events.mjs';
import {NOW,transaction} from './db.mjs';
import {requireClarificationPrincipal} from './clarifications.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {clarificationFlowInput} from './clarification-flow-input.mjs';
import {translatedContent,translationCheck} from './ai/prepared-bundle.mjs';
export function ensureClarificationFlowSchema(db){
 const create=`CREATE TABLE IF NOT EXISTS clarification_exchanges (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,site_id TEXT NOT NULL,case_id TEXT NOT NULL,assignment_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL,kind TEXT NOT NULL,actor_id TEXT NOT NULL,actor_role TEXT,source_language TEXT NOT NULL,target_language TEXT NOT NULL,
 source_text TEXT NOT NULL,request_hash TEXT NOT NULL,translated_text TEXT,state TEXT NOT NULL,created_at TEXT NOT NULL,delivered_at TEXT) STRICT;`;
 const previous=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='clarification_exchanges'").get();
 if(previous?.sql.includes('UNIQUE(attempt_id,kind)')){
  db.exec('SAVEPOINT clarification_flow_upgrade');
  try{db.exec('ALTER TABLE clarification_exchanges RENAME TO clarification_exchanges_legacy');db.exec(create);
  const columns=db.prepare('PRAGMA table_info(clarification_exchanges_legacy)').all().map(row=>'"'+row.name+'"').join(',');
  db.exec(`INSERT INTO clarification_exchanges(${columns}) SELECT ${columns} FROM clarification_exchanges_legacy;DROP TABLE clarification_exchanges_legacy;RELEASE clarification_flow_upgrade`);
  }catch(error){db.exec('ROLLBACK TO clarification_flow_upgrade;RELEASE clarification_flow_upgrade');throw error;}
 }else db.exec(create);
}

function context(db,session,id,worker=false,write=false){
  requireClarificationPrincipal(db,session,worker?'worker':'staff',write);
  const row=db.prepare(`SELECT a.id AS assignment_id,a.worker_id,a.language,w.language AS worker_language,w.code AS worker,p.snapshot_json,
    t.id AS attempt_id,t.answer_text,t.outcome,c.id AS case_id,c.status,COALESCE(ss.staff_interface_language,'en') AS staff_language
    FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    LEFT JOIN site_settings ss ON ss.site_id=a.site_id AND ss.org_id=a.org_id
    JOIN attempts t ON t.id=(SELECT at.id FROM attempts at JOIN submission_receipts sr ON sr.assignment_id=at.assignment_id AND sr.submission_id=at.submission_id WHERE at.assignment_id=a.id ORDER BY sr.sequence DESC LIMIT 1)
    LEFT JOIN clarifications c ON c.id=(SELECT cc.id FROM clarifications cc WHERE cc.assignment_id=a.id ORDER BY cc.created_at DESC,cc.rowid DESC LIMIT 1)
    WHERE a.org_id=? AND a.site_id=? AND ${worker?'a.id=? AND a.worker_id=?':'EXISTS(SELECT 1 FROM clarifications selected WHERE selected.id=? AND selected.assignment_id=a.id AND selected.org_id=a.org_id)'} AND w.active=1 AND p.state='published'
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id)`).get(session.org_id,session.site_id,id,...(worker?[session.principal_id]:[]));
  if(!row||JSON.parse(row.snapshot_json).rubric?.mode!=='multiple-choice')throw Error('Clarification unavailable');if(write){requireWritableEntitlement(db,session.org_id);requireSiteOperational(db,session.org_id,session.site_id);}return row;
}
export function listClarificationFlow(db,session,page=1,{briefingId=null,day=null}={}){
  ensureClarificationFlowSchema(db);requireClarificationPrincipal(db,session);
  day=clarificationDay(day);
  if(!Number.isSafeInteger(page)||page<1||page>5000)throw Error('Invalid clarification page');
  const all=db.prepare(`SELECT c.id,c.created_at,s.timezone,w.code AS worker,json_extract(p.snapshot_json,'$.title') AS title,
    (SELECT json_group_array(e.created_at) FROM clarification_exchanges e WHERE e.case_id=c.id AND e.org_id=c.org_id AND e.site_id=a.site_id AND e.kind='request') AS request_dates FROM clarifications c
    JOIN assignments a ON a.id=c.assignment_id JOIN publications p ON p.id=a.publication_id JOIN workers w ON w.id=a.worker_id JOIN sites s ON s.id=a.site_id AND s.org_id=a.org_id
    WHERE c.org_id=? AND a.site_id=? AND (? IS NULL OR p.briefing_id=?) AND p.state='published' AND w.active=1
      AND (? IS NOT NULL OR c.id=(SELECT cc.id FROM clarifications cc WHERE cc.assignment_id=a.id ORDER BY cc.created_at DESC,cc.rowid DESC LIMIT 1))
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id) AND json_extract(p.snapshot_json,'$.rubric.mode')='multiple-choice'
      AND (? IS NOT NULL OR ? IS NOT NULL OR c.status='open' OR (SELECT max(e.created_at) FROM clarification_exchanges e WHERE e.assignment_id=a.id AND e.kind='request')>(SELECT max(e.created_at) FROM clarification_exchanges e WHERE e.assignment_id=a.id AND e.kind='explanation'))
    ORDER BY c.created_at DESC,c.id DESC`).all(session.org_id,session.site_id,briefingId,briefingId,day,day,briefingId).filter(row=>!day||[row.created_at,...JSON.parse(row.request_dates)].some(date=>clarificationDateAt(date,row.timezone)===day)).map(({id,worker,title})=>({id,worker,title}));
  return {rows:all.slice((page-1)*20,page*20),total:all.length,page};
}
export function readClarificationFlow(db,session,id,{worker=false}={}){
  ensureClarificationFlowSchema(db);let row;try{row=context(db,session,id,worker);}catch(error){if(worker&&error.message==='Clarification unavailable')return {caseId:null,needsArea:false,items:[]};throw error;}
  const items=db.prepare('SELECT * FROM clarification_exchanges WHERE assignment_id=? AND org_id=? AND site_id=? ORDER BY rowid').all(row.assignment_id,session.org_id,session.site_id);
  const snapshot=JSON.parse(row.snapshot_json),content=snapshot.languages?.[worker?row.worker_language:row.staff_language]??snapshot.languages?.[row.language];
  return {caseId:row.case_id,assignmentId:row.assignment_id,attemptId:row.attempt_id,worker:row.worker,title:content?.title??snapshot.title,instruction:content?.text??'',question:content?.question??'',answer:content?.choices?.find(choice=>choice.id===row.answer_text)?.text??row.answer_text,outcome:row.outcome,status:row.status,
    canMessage:['matched','clarification'].includes(row.outcome),needsArea:row.outcome==='clarification'&&!items.some(item=>item.kind==='request'||item.kind==='explanation'&&item.state==='delivered'),
    items:items.map(item=>({id:item.id,kind:item.kind,state:item.state,text:item.state==='delivered'?item.translated_text:null,language:item.target_language,
      originalText:(worker?item.kind==='request':item.kind==='explanation')?item.source_text:null,originalLanguage:(worker?item.kind==='request':item.kind==='explanation')?item.source_language:null,createdAt:item.created_at,attemptId:item.attempt_id}))};
}
export function saveClarificationExchange(db,session,id,input,{worker=false}={}){
  const value=clarificationFlowInput(input);ensureClarificationFlowSchema(db);
  return transaction(db,()=>{
    const row=context(db,session,id,worker,true),kind=worker?'request':'explanation',old=db.prepare('SELECT * FROM clarification_exchanges WHERE id=?').get(value.id);
    if(old){if(old.org_id!==session.org_id||old.site_id!==session.site_id||old.assignment_id!==row.assignment_id||old.actor_id!==session.principal_id||old.kind!==kind||old.request_hash!==value.hash)throw Error('Conversation request conflict');if(old.state==='failed'&&['matched','clarification'].includes(row.outcome)){db.prepare("UPDATE clarification_exchanges SET state='queued' WHERE id=?").run(old.id);return {id:old.id,state:'queued'};}return {id:old.id,state:old.state};}
    if(!['matched','clarification'].includes(row.outcome))throw Error('Clarification unavailable');
    if(!row.case_id||row.status!=='open'){
      row.case_id=randomUUID();row.status='open';
      db.prepare('INSERT INTO clarifications VALUES(?,?,?,?,?,?,?,?,?)').run(row.case_id,session.org_id,row.assignment_id,null,'Help requested',null,'open','',NOW());
      routeNewCase(db,session.org_id,session.site_id,row.case_id);
    }
    const source=worker?row.worker_language:row.staff_language,target=worker?row.staff_language:row.worker_language,state=source===target&&worker?'delivered':'queued';
    db.prepare('INSERT INTO clarification_exchanges(id,org_id,site_id,case_id,assignment_id,attempt_id,kind,actor_id,actor_role,source_language,target_language,source_text,request_hash,translated_text,state,created_at,delivered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(value.id,session.org_id,session.site_id,row.case_id,row.assignment_id,row.attempt_id,kind,session.principal_id,worker?null:session.role,source,target,value.text,value.hash,state==='delivered'?value.text:null,state,NOW(),state==='delivered'?NOW():null);
    if(worker)staffAuditOnce(db,{orgId:session.org_id,siteId:session.site_id,action:'help.requested',objectId:value.id});
    return {id:value.id,state};
  });
}
// Existing callers may still check for a follow-up, but clarification messages never open a quiz.
export function pendingFlowRepeat(db,assignmentId){return null;}
export async function processOneClarificationExchange(db,adapter){
  ensureClarificationFlowSchema(db);const job=db.prepare("SELECT * FROM clarification_exchanges WHERE state='queued' ORDER BY created_at,id LIMIT 1").get();if(!job)return false;
  try{
    let text=job.source_text;
    if(job.source_language!==job.target_language){
      if(!adapter?.translate||!adapter?.checkTranslation)throw Error('Translation unavailable');
      const source={title:'Instruction clarification',text,question:'Clarification message'};
      const target=translatedContent(await adapter.translate(source,job.target_language),job.target_language);translationCheck(await adapter.checkTranslation(source,target,job.target_language));text=target.text;
    }
    transaction(db,()=>{const worker=job.kind==='request',row=context(db,{principal_type:worker?'worker':'staff',principal_id:job.actor_id,org_id:job.org_id,site_id:job.site_id,role:job.actor_role},worker?job.assignment_id:job.case_id,worker,true);
      if(job.kind==='explanation'){
        db.prepare("UPDATE clarifications SET status='resolved',notes='[Understood:ready]Instruction clarified by supervisor' WHERE id=? AND status='open' AND NOT EXISTS(SELECT 1 FROM clarification_exchanges e WHERE e.case_id=? AND e.kind='request' AND e.created_at>?)").run(job.case_id,job.case_id,job.created_at);
        recordWorkerEvent(db,{orgId:job.org_id,siteId:job.site_id,workerId:row.worker_id,kind:'clarification.followup',objectType:'assignment',objectId:job.assignment_id,dedupeKey:`clarification.message:${job.id}`});
      }
      db.prepare("UPDATE clarification_exchanges SET state='delivered',translated_text=?,delivered_at=? WHERE id=? AND state='queued'").run(text,NOW(),job.id);
    });
  }catch{db.prepare("UPDATE clarification_exchanges SET state='failed' WHERE id=? AND state='queued'").run(job.id);}
  return true;
}
