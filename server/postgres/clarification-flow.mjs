import {routeNewCase} from './case-routing.mjs';
import {randomUUID} from 'node:crypto';
import {domainTransaction,requirePrincipal,domainAudit} from './domain.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {dispatchAllowed} from './operations-gates.mjs';
import {recordWorkerEvent,staffAuditOnce} from './notification-events.mjs';
import {clarificationFlowInput,clarificationTranslationHash} from '../clarification-flow-input.mjs';
import {translatedContent,translationCheck} from '../ai/prepared-bundle.mjs';

// Keep messages attached to the instruction, including requests after a correct answer.
async function context(client,session,id,worker=false,write=false){
  await requirePrincipal(client,session,worker?'worker':'staff',write?['owner','supervisor']:['owner','supervisor','auditor']);
  const row=(await client.query(`SELECT a.id AS assignment_id,a.publication_id,a.worker_id,a.language,w.language AS worker_language,w.code AS worker,
    p.snapshot_json,p.version,t.id AS attempt_id,t.answer_text,t.outcome,c.id AS case_id,c.status,
    COALESCE(ss.staff_interface_language,'en') AS staff_language
    FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
    LEFT JOIN site_settings ss ON ss.site_id=a.site_id AND ss.org_id=a.org_id
    JOIN LATERAL (SELECT at.* FROM attempts at JOIN submission_receipts sr ON sr.assignment_id=at.assignment_id AND sr.submission_id=at.submission_id
      WHERE at.assignment_id=a.id AND at.org_id=a.org_id ORDER BY sr.sequence DESC LIMIT 1) t ON true
    LEFT JOIN LATERAL (SELECT cc.* FROM clarifications cc WHERE cc.assignment_id=a.id AND cc.org_id=a.org_id AND NOT EXISTS(SELECT 1 FROM case_content_purges retired WHERE retired.case_id=cc.id)
      ORDER BY cc.created_at DESC,cc.id DESC LIMIT 1) c ON true
    WHERE a.org_id=$1 AND a.site_id=$2 AND ${worker?'a.id=$3 AND a.worker_id=$4':'EXISTS(SELECT 1 FROM clarifications selected WHERE selected.id=$3 AND selected.assignment_id=a.id AND selected.org_id=a.org_id AND selected.site_id=a.site_id)'} AND w.active AND p.state='published'
      AND publication_content_available(p.id)
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id)
      AND NOT EXISTS(SELECT 1 FROM case_content_purges cp WHERE cp.case_id=c.id)
      ${write?'FOR UPDATE OF a':''}`,[session.org_id,session.site_id,id,...(worker?[session.principal_id]:[])])).rows[0];
  if(!row)throw Error('Clarification unavailable');
  if(row.snapshot_json?.rubric?.mode!=='multiple-choice')throw Error('Clarification unavailable');
  if(write){
    await requireWritableEntitlement(client,session.org_id);await requireSiteOperational(client,session.org_id,session.site_id);
    // Refresh after the assignment lock: a concurrent sender may have opened a case while we waited.
    const latest=(await client.query(`SELECT c.id,c.status FROM clarifications c WHERE c.assignment_id=$1 AND c.org_id=$2 AND c.site_id=$3
      AND NOT EXISTS(SELECT 1 FROM case_content_purges retired WHERE retired.case_id=c.id)
      ORDER BY c.created_at DESC,c.id DESC LIMIT 1`,[row.assignment_id,session.org_id,session.site_id])).rows[0];
    row.case_id=latest?.id??null;row.status=latest?.status??null;
  }
  return row;
}
const exchange=row=>({id:row.id,kind:row.kind,state:row.state,text:row.state==='delivered'?row.translated_text:null,
  language:row.target_language,originalText:row.source_text,originalLanguage:row.source_language,createdAt:row.created_at,attemptId:row.attempt_id});
export function listClarificationFlow(pool,session,page=1,{schema='public'}={}){
  if(!Number.isSafeInteger(page)||page<1||page>5000)throw Error('Invalid clarification page');
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const rows=(await client.query(`SELECT c.id,w.code AS worker,p.snapshot_json->>'title' AS title,count(*) OVER()::int AS total
      FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id AND a.site_id=c.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE c.org_id=$1 AND c.site_id=$2 AND c.id=(SELECT cc.id FROM clarifications cc WHERE cc.assignment_id=a.id AND cc.org_id=a.org_id ORDER BY cc.created_at DESC,cc.id DESC LIMIT 1) AND p.snapshot_json->'rubric'->>'mode'='multiple-choice'
        AND p.state='published' AND publication_content_available(p.id) AND w.active
        AND (c.status='open' OR (SELECT max(e.created_at) FROM clarification_exchanges e WHERE e.assignment_id=a.id AND e.kind='request')>(SELECT max(e.created_at) FROM clarification_exchanges e WHERE e.assignment_id=a.id AND e.kind='explanation'))
        AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=w.id)
        AND NOT EXISTS(SELECT 1 FROM case_content_purges cp WHERE cp.case_id=c.id)
      ORDER BY c.created_at DESC,c.id DESC LIMIT 20 OFFSET $3`,[session.org_id,session.site_id,(page-1)*20])).rows;
    return {rows:rows.map(({id,worker,title})=>({id,worker,title})),total:rows[0]?.total??0,page};
  });
}
export function readClarificationFlow(pool,session,id,{schema='public',worker=false}={}){
  return domainTransaction(pool,schema,async client=>{
    let row;try{row=await context(client,session,id,worker);}catch(error){if(worker&&error.message==='Clarification unavailable')return {caseId:null,needsArea:false,items:[]};throw error;}
    const items=(await client.query('SELECT * FROM clarification_exchanges e WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3 AND NOT EXISTS(SELECT 1 FROM case_content_purges retired WHERE retired.case_id=e.case_id) ORDER BY created_at DESC,id DESC LIMIT 1000',[row.assignment_id,session.org_id,session.site_id])).rows.reverse();
    const request=items.find(item=>item.attempt_id===row.attempt_id&&item.kind==='request');
    const locale=worker?row.worker_language:row.staff_language,content=row.snapshot_json.languages?.[locale]??row.snapshot_json.languages?.[row.language];
    const choice=content?.choices?.find(item=>item.id===row.answer_text);
    return {caseId:row.case_id,assignmentId:row.assignment_id,attemptId:row.attempt_id,worker:row.worker,title:content?.title??row.snapshot_json.title,
      instruction:content?.text??'',question:content?.question??'',answer:choice?.text??row.answer_text,outcome:row.outcome,status:row.status,
      canMessage:['matched','clarification'].includes(row.outcome),needsArea:row.outcome==='clarification'&&!request&&!items.some(item=>item.kind==='explanation'&&item.state==='delivered'),items:items.map(item=>{
        // A recipient sees only its translation; the author may also recover their original text.
        const own=worker?item.kind==='request':item.kind==='explanation';
        return {...exchange(item),originalText:own?item.source_text:null,originalLanguage:own?item.source_language:null};
      })};
  });
}
export function saveClarificationExchange(pool,session,id,input,{schema='public',worker=false,integrationMode='synthetic'}={}){
  const value=clarificationFlowInput(input),kind=worker?'request':'explanation';
  return domainTransaction(pool,schema,async client=>{
    const row=await context(client,session,id,worker,true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`clarification-exchange:${value.id}`]);
    const previous=(await client.query('SELECT * FROM clarification_exchanges WHERE id=$1',[value.id])).rows[0];
    if(previous){if(previous.org_id!==session.org_id||previous.site_id!==session.site_id||previous.assignment_id!==row.assignment_id||previous.actor_id!==session.principal_id||previous.kind!==kind||previous.request_hash!==value.hash)throw Error('Conversation request conflict');
      if(previous.state==='failed'&&['matched','clarification'].includes(row.outcome)){
        await client.query("UPDATE clarification_exchanges SET state='queued',attempts=0,retry_at=clock_timestamp(),error_code=NULL WHERE id=$1",[previous.id]);return {id:previous.id,state:'queued'};
      }
      return {id:previous.id,state:previous.state};}
    if(!['matched','clarification'].includes(row.outcome))throw Error('Clarification unavailable');
    if(!row.case_id||row.status!=='open'){
      row.case_id=randomUUID();row.status='open';
      await client.query("INSERT INTO clarifications(id,org_id,site_id,assignment_id,attempt_id,reason,status) VALUES($1,$2,$3,$4,$5,'Help requested','open')",[row.case_id,session.org_id,session.site_id,row.assignment_id,null]);
      await routeNewCase(client,session.org_id,session.site_id,row.case_id);
    }
    const source=worker?row.worker_language:row.staff_language,target=worker?row.staff_language:row.worker_language;
    const saved=(await client.query(`INSERT INTO clarification_exchanges(id,org_id,site_id,case_id,assignment_id,attempt_id,kind,actor_id,actor_role,source_language,target_language,source_text,request_hash,translated_text,state,delivered_at,data_class)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CASE WHEN $15='delivered' THEN clock_timestamp() ELSE NULL END,$16)
      RETURNING *`,[value.id,session.org_id,session.site_id,row.case_id,row.assignment_id,row.attempt_id,kind,session.principal_id,worker?null:session.role,source,target,value.text,value.hash,source===target?value.text:null,source===target&&worker?'delivered':'queued',integrationMode==='live'?'real':'synthetic'])).rows[0];
    if(!saved)throw Error('A clarification has already been sent for this answer');
    await domainAudit(client,session,worker?'help.requested':'clarification.followup_requested',row.case_id);
    return {id:saved.id,state:saved.state};
  });
}
export async function currentClarificationTranslation(client,id,token,orgId,hash){
  const job=(await client.query("SELECT * FROM clarification_exchanges WHERE id=$1 AND lease_token=$2 AND org_id=$3 AND state='processing' AND lease_until>clock_timestamp()",[id,token,orgId])).rows[0];
  if(!job||clarificationTranslationHash(job)!==hash)throw Error('Clarification translation authority changed');
  const worker=job.kind==='request',session={principal_type:worker?'worker':'staff',principal_id:job.actor_id,org_id:job.org_id,site_id:job.site_id,role:job.actor_role};
  const row=await context(client,session,worker?job.assignment_id:job.case_id,worker,true);
  if((worker?row.staff_language:row.worker_language)!==job.target_language||(await client.query('SELECT 1 FROM case_content_purges WHERE case_id=$1',[job.case_id])).rows.length)throw Error('Clarification translation obsolete');
  await client.query("UPDATE clarification_exchanges SET lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1 AND lease_token=$2",[id,token]);
  return {job,row};
}
async function deliver(client,job,text){
  const {row}=await currentClarificationTranslation(client,job.id,job.token,job.org_id,clarificationTranslationHash(job));
  if(job.kind==='explanation'){
    // A clarification is a translated message; it never creates a question or an answer retry.
    await recordWorkerEvent(client,{orgId:job.org_id,siteId:job.site_id,workerId:row.worker_id,kind:'clarification.followup',objectType:'assignment',objectId:job.assignment_id,dedupeKey:`clarification.message:${job.id}`});
    await client.query(`UPDATE clarifications SET status='resolved',notes='[Understood:ready]Instruction clarified by supervisor'
      WHERE id=$1 AND org_id=$2 AND site_id=$3 AND status='open'
      AND NOT EXISTS(SELECT 1 FROM clarification_exchanges e WHERE e.case_id=$1 AND e.kind='request' AND e.created_at>$4)`,[job.case_id,job.org_id,job.site_id,job.created_at]);
  }else await staffAuditOnce(client,{orgId:job.org_id,siteId:job.site_id,action:'help.requested',objectId:job.id});
  await client.query("UPDATE clarification_exchanges SET state='delivered',translated_text=$3,delivered_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=$1 AND lease_token=$2",[job.id,job.token,text]);
}
export async function processOneClarificationExchange(pool,adapter,{schema='public',dataClass='synthetic'}={}){
  const job=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT * FROM clarification_exchanges WHERE (state='queued' AND retry_at<=clock_timestamp()) OR (state='processing' AND lease_until<=clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if(!row||!await dispatchAllowed(client,row.org_id,{provider:true}))return null;
    if(row.attempts>=3){await client.query("UPDATE clarification_exchanges SET state='failed',lease_token=NULL,lease_until=NULL,error_code='translation_unavailable' WHERE id=$1",[row.id]);return {exhausted:true};}
    const token=randomUUID();await client.query("UPDATE clarification_exchanges SET state='processing',lease_token=$2,lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1 WHERE id=$1",[row.id,token]);return {...row,token};
  });
  if(!job)return false;if(job.exhausted)return true;
  try{
    let text=job.source_text;
    if(job.source_language!==job.target_language){
      if(!adapter?.translate||!adapter?.checkTranslation||adapter.provenance?.dataClass!==dataClass||job.data_class!==dataClass)throw Error('Clarification translation unavailable');
      const call=async(method,...args)=>{
        await domainTransaction(pool,schema,client=>currentClarificationTranslation(client,job.id,job.token,job.org_id,clarificationTranslationHash(job)));
        let provider=adapter;
        if(dataClass==='real'){
          const {reserveProviderOperation,providerRequestJournal}=await import('./provider-budget.mjs');
          const provenance={adapter:adapter.provenance.adapter,dataClass,model:method==='translate'?(adapter.provenance.translationModel??adapter.provenance.textModel):adapter.provenance.textModel,promptVersion:method==='translate'?'clarification-translate-v1':'clarification-check-v1',schemaVersion:'clarification-translation-v1'};
          const operation=await domainTransaction(pool,schema,client=>reserveProviderOperation(client,{orgId:job.org_id,kind:'clarification-translation',referenceId:job.id,claimToken:job.token,model:provenance.model,dataClass,maxRequests:1,inputHash:clarificationTranslationHash(job),provenance}));
          if(!adapter.withJournal)throw Error('Clarification translation unavailable');provider=adapter.withJournal(providerRequestJournal(pool,operation,{schema}));
        }
        return provider[method](...args);
      };
      const source={title:'Instruction clarification',text:job.source_text,question:'Clarification message'};
      const target=translatedContent(await call('translate',source,job.target_language),job.target_language);
      translationCheck(await call('checkTranslation',source,target,job.target_language));
      if(target.text.length>1000)throw Error('Clarification translation unavailable');text=target.text;
    }
    await domainTransaction(pool,schema,client=>deliver(client,job,text));
  }catch{
    await domainTransaction(pool,schema,client=>client.query("UPDATE clarification_exchanges SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,lease_token=NULL,lease_until=NULL,retry_at=clock_timestamp()+interval '30 seconds',error_code='translation_unavailable' WHERE id=$1 AND lease_token=$2",[job.id,job.token]));
  }
  return true;
}
