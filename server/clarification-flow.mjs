import {NOW,transaction} from './db.mjs';
import {requireClarificationPrincipal} from './clarifications.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {clarificationFlowInput} from './clarification-flow-input.mjs';
import {translatedContent,translationCheck} from './ai/prepared-bundle.mjs';
export function ensureClarificationFlowSchema(db){db.exec(`CREATE TABLE IF NOT EXISTS clarification_exchanges (
 id TEXT PRIMARY KEY,org_id TEXT NOT NULL,site_id TEXT NOT NULL,case_id TEXT NOT NULL,assignment_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL,kind TEXT NOT NULL,actor_id TEXT NOT NULL,actor_role TEXT,source_language TEXT NOT NULL,target_language TEXT NOT NULL,
 source_text TEXT NOT NULL,request_hash TEXT NOT NULL,translated_text TEXT,state TEXT NOT NULL,created_at TEXT NOT NULL,delivered_at TEXT,
 UNIQUE(attempt_id,kind)) STRICT;`);}
function context(db,session,id,worker=false,write=false){
  requireClarificationPrincipal(db,session,worker?'worker':'staff',write);
  const row=db.prepare(`SELECT a.id AS assignment_id,a.worker_id,a.language,w.language AS worker_language,w.code AS worker,p.snapshot_json,
    t.id AS attempt_id,t.answer_text,t.outcome,c.id AS case_id,c.status,COALESCE(ss.staff_interface_language,'en') AS staff_language
    FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    LEFT JOIN site_settings ss ON ss.site_id=a.site_id AND ss.org_id=a.org_id
    JOIN attempts t ON t.id=(SELECT at.id FROM attempts at JOIN submission_receipts sr ON sr.assignment_id=at.assignment_id AND sr.submission_id=at.submission_id WHERE at.assignment_id=a.id ORDER BY sr.sequence DESC LIMIT 1)
    JOIN clarifications c ON c.id=(SELECT cc.id FROM clarifications cc WHERE cc.assignment_id=a.id AND cc.attempt_id=t.id ORDER BY cc.created_at DESC,cc.id DESC LIMIT 1)
    WHERE a.org_id=? AND a.site_id=? AND ${worker?'a.id=? AND a.worker_id=?':'c.id=?'} AND w.active=1 AND p.state='published'
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id)`).get(session.org_id,session.site_id,id,...(worker?[session.principal_id]:[]));
  if(!row||JSON.parse(row.snapshot_json).rubric?.mode!=='multiple-choice')throw Error('Clarification unavailable');if(write){requireWritableEntitlement(db,session.org_id);requireSiteOperational(db,session.org_id,session.site_id);}return row;
}
export function listClarificationFlow(db,session,page=1){
  ensureClarificationFlowSchema(db);requireClarificationPrincipal(db,session);
  if(!Number.isSafeInteger(page)||page<1||page>5000)throw Error('Invalid clarification page');
  const all=db.prepare(`SELECT c.id,w.code AS worker,json_extract(p.snapshot_json,'$.title') AS title FROM clarifications c
    JOIN assignments a ON a.id=c.assignment_id JOIN publications p ON p.id=a.publication_id JOIN workers w ON w.id=a.worker_id
    WHERE c.org_id=? AND a.site_id=? AND c.status='open' AND p.state='published' AND w.active=1
      AND c.attempt_id=(SELECT t.id FROM attempts t JOIN submission_receipts sr ON sr.assignment_id=t.assignment_id AND sr.submission_id=t.submission_id WHERE t.assignment_id=a.id ORDER BY sr.sequence DESC LIMIT 1)
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id) AND json_extract(p.snapshot_json,'$.rubric.mode')='multiple-choice'
      AND (SELECT t.outcome FROM attempts t JOIN submission_receipts sr ON sr.assignment_id=t.assignment_id AND sr.submission_id=t.submission_id WHERE t.assignment_id=a.id ORDER BY sr.sequence DESC LIMIT 1)='clarification'
    ORDER BY c.created_at DESC,c.id DESC`).all(session.org_id,session.site_id);
  return {rows:all.slice((page-1)*20,page*20),total:all.length,page};
}
export function readClarificationFlow(db,session,id,{worker=false}={}){
  ensureClarificationFlowSchema(db);let row;try{row=context(db,session,id,worker);}catch(error){if(worker&&error.message==='Clarification unavailable')return {caseId:null,needsArea:false,items:[]};throw error;}
  const items=db.prepare('SELECT * FROM clarification_exchanges WHERE case_id=? AND org_id=? AND site_id=? ORDER BY created_at,id').all(row.case_id,session.org_id,session.site_id);
  const snapshot=JSON.parse(row.snapshot_json),content=snapshot.languages?.[worker?row.worker_language:row.staff_language]??snapshot.languages?.[row.language];
  return {caseId:row.case_id,assignmentId:row.assignment_id,attemptId:row.attempt_id,worker:row.worker,title:content?.title??snapshot.title,instruction:content?.text??'',question:content?.question??'',answer:content?.choices?.find(choice=>choice.id===row.answer_text)?.text??row.answer_text,outcome:row.outcome,status:row.status,
    needsArea:row.outcome==='clarification'&&!items.some(item=>item.attempt_id===row.attempt_id&&item.kind==='request'),
    items:items.map(item=>({id:item.id,kind:item.kind,state:item.state,text:item.state==='delivered'?item.translated_text:null,language:item.target_language,
      originalText:(worker?item.kind==='request':item.kind==='explanation')?item.source_text:null,originalLanguage:(worker?item.kind==='request':item.kind==='explanation')?item.source_language:null,createdAt:item.created_at,attemptId:item.attempt_id}))};
}
export function saveClarificationExchange(db,session,id,input,{worker=false}={}){
  const value=clarificationFlowInput(input);ensureClarificationFlowSchema(db);
  return transaction(db,()=>{
    const row=context(db,session,id,worker,true),kind=worker?'request':'explanation',old=db.prepare('SELECT * FROM clarification_exchanges WHERE id=?').get(value.id);
    if(old){if(old.org_id!==session.org_id||old.site_id!==session.site_id||old.case_id!==row.case_id||old.actor_id!==session.principal_id||old.kind!==kind||old.request_hash!==value.hash)throw Error('Conversation request conflict');if(old.state==='failed'&&old.attempt_id===row.attempt_id&&row.status==='open'){db.prepare("UPDATE clarification_exchanges SET state='queued' WHERE id=?").run(old.id);return {id:old.id,state:'queued'};}return {id:old.id,state:old.state};}
    if(row.outcome!=='clarification'||row.status!=='open')throw Error('Clarification unavailable');
    if(!worker&&!db.prepare("SELECT 1 FROM clarification_exchanges WHERE attempt_id=? AND kind='request' AND state='delivered'").get(row.attempt_id))throw Error('Wait for the worker clarification request');
    if(db.prepare('SELECT 1 FROM clarification_exchanges WHERE attempt_id=? AND kind=?').get(row.attempt_id,kind))throw Error('A clarification has already been sent for this answer');
    const source=worker?row.worker_language:row.staff_language,target=worker?row.staff_language:row.worker_language,state=source===target&&worker?'delivered':'queued';
    db.prepare('INSERT INTO clarification_exchanges VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(value.id,session.org_id,session.site_id,row.case_id,row.assignment_id,row.attempt_id,kind,session.principal_id,worker?null:session.role,source,target,value.text,value.hash,state==='delivered'?value.text:null,state,NOW(),state==='delivered'?NOW():null);
    return {id:value.id,state};
  });
}
export function pendingFlowRepeat(db,assignmentId){
  ensureClarificationFlowSchema(db);
  const row=db.prepare(`SELECT e.* FROM clarification_exchanges e WHERE e.assignment_id=? AND e.kind='explanation' AND e.state='delivered'
    AND e.attempt_id=(SELECT t.id FROM attempts t JOIN submission_receipts sr ON sr.assignment_id=t.assignment_id AND sr.submission_id=t.submission_id WHERE t.assignment_id=e.assignment_id ORDER BY sr.sequence DESC LIMIT 1)`).get(assignmentId);
  return row?{id:row.id,caseId:row.case_id,dueAt:new Date(Date.parse(row.delivered_at)+86400000).toISOString(),message:row.translated_text}:null;
}
export async function processOneClarificationExchange(db,adapter){
  ensureClarificationFlowSchema(db);const job=db.prepare("SELECT * FROM clarification_exchanges WHERE state='queued' ORDER BY created_at,id LIMIT 1").get();if(!job)return false;
  try{
    let text=job.source_text;
    if(job.source_language!==job.target_language){
      if(!adapter?.translate||!adapter?.checkTranslation)throw Error('Translation unavailable');
      const source={title:'Instruction clarification',text,question:'Which part needs explaining?'};
      const target=translatedContent(await adapter.translate(source,job.target_language),job.target_language);translationCheck(await adapter.checkTranslation(source,target,job.target_language));text=target.text;
    }
    transaction(db,()=>{const worker=job.kind==='request',row=context(db,{principal_type:worker?'worker':'staff',principal_id:job.actor_id,org_id:job.org_id,site_id:job.site_id,role:job.actor_role},worker?job.assignment_id:job.case_id,worker,true);
      if(row.attempt_id!==job.attempt_id||row.status!=='open')throw Error('Clarification obsolete');
      db.prepare("UPDATE clarification_exchanges SET state='delivered',translated_text=?,delivered_at=? WHERE id=? AND state='queued'").run(text,NOW(),job.id);
    });
  }catch{db.prepare("UPDATE clarification_exchanges SET state='failed' WHERE id=? AND state='queued'").run(job.id);}
  return true;
}
