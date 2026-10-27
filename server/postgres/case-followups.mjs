import {providerDataClass} from '../ai/provider-policy.mjs';
import {randomUUID} from 'node:crypto';
import {domainTransaction,domainAudit} from './domain.mjs';
import {scopedCase} from './case-messages.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
import {caseMessageInput,caseMessageId} from '../case-message-input.mjs';
import {generateCaseFollowup,checkedCaseFollowupBundle,caseFollowupInputHash,checkedFollowupProvenance,CaseFollowupError} from '../ai/case-followup-bundle.mjs';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {inspectWav} from '../audio.mjs';
import {reserveProviderOperation,providerRequestJournal} from './provider-budget.mjs';

const receipt=row=>({id:row.id,caseId:row.case_id,status:row.status,language:row.language,
  createdAt:new Date(row.created_at).toISOString(),deliveredAt:row.delivered_at?new Date(row.delivered_at).toISOString():null,
  errorCode:row.error_code ?? null});
const author=row=>({org_id:row.org_id,site_id:row.site_id,principal_type:'staff',principal_id:row.actor_id,role:row.actor_role});
const identity=row=>({orgId:row.org_id,siteId:row.site_id,caseId:row.case_id,assignmentId:row.assignment_id,
  publicationId:row.publication_id,requestId:row.id,language:row.language});
function available({adapter,dataClass}) {
  if(!['synthetic','real'].includes(dataClass) || !providerDataClass(adapter?.provenance) || adapter.provenance.dataClass!==dataClass)throw Error('Follow-up generation unavailable');
}
function exact(row,session,caseId) {
  if(!row || row.org_id!==session.org_id || row.site_id!==session.site_id || row.case_id!==caseId || row.actor_id!==session.principal_id)
    throw Error('Follow-up receipt unavailable');return row;
}
export function followupReceipt(pool,session,caseId,id,{schema='public'}={}) {
  caseMessageId(id);return domainTransaction(pool,schema,async client=>{
    await scopedCase(client,session,caseId);if(session.principal_type!=='staff')throw Error('Forbidden');
    return receipt(exact((await client.query('SELECT * FROM case_followups WHERE id=$1',[id])).rows[0],session,caseId));
  });
}
export function queueCaseFollowup(pool,session,caseId,input,{schema='public',adapter,dataClass}={}) {
  const value=caseMessageInput(input);
  return domainTransaction(pool,schema,async client=>{
    if(session.principal_type!=='staff')throw Error('Forbidden');
    const thread=await scopedCase(client,session,caseId,true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`case-message:${value.id}`]);
    const old=(await client.query('SELECT * FROM case_followups WHERE id=$1',[value.id])).rows[0];
    if(old){exact(old,session,caseId);if(old.request_hash!==value.hash)throw Error('Conversation request conflict');return receipt(old);}
    if((await client.query('SELECT 1 FROM case_messages WHERE id=$1',[value.id])).rows.length)throw Error('Conversation request conflict');
    if(thread.status!=='open' || !thread.active || thread.publication_state!=='published' || !thread.content_available)throw Error('Conversation is closed');
    available({adapter,dataClass});
    if(!adapter.capabilities?.textLanguages.includes(thread.language) || !adapter.capabilities?.speechLanguages.includes(thread.language))
      throw Error('Follow-up language unavailable');
    const glossary=await readGlossarySnapshot(client,session.org_id,session.site_id);
    const row=(await client.query(`INSERT INTO case_followups(id,org_id,site_id,case_id,assignment_id,publication_id,actor_id,actor_role,
      language,source_text,request_hash,glossary_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [value.id,session.org_id,session.site_id,caseId,thread.assignment_id,thread.publication_id,session.principal_id,session.role,
        thread.language,value.text,value.hash,JSON.stringify(glossary)])).rows[0];
    await domainAudit(client,session,'clarification.followup_requested',row.id);return receipt(row);
  });
}
export async function checkCaseFollowupClaim(client,job) {
  if(!await dispatchAllowed(client,job.org_id,{provider:true}))throw Error('Operational dispatch paused');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('understood:glossary:'||current_schema()||':'||$1||':'||$2,0))",[job.org_id,job.site_id]);
  const thread=await scopedCase(client,author(job),job.case_id,true);
  if(thread.status!=='open' || !thread.active || thread.publication_state!=='published' || !thread.content_available
    || thread.assignment_id!==job.assignment_id || thread.publication_id!==job.publication_id || thread.language!==job.language)
    throw Error('Follow-up obsolete');
  if((await client.query('SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=$1',[job.assignment_id])).rows.length)
    throw Error('Follow-up obsolete');
  const row=(await client.query(`UPDATE case_followups SET lease_until=clock_timestamp()+interval '180 seconds'
    WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() RETURNING *`,[job.id,job.token])).rows[0];
  if(!row || row.source_text!==job.source_text || bundleHash(row.glossary_json)!==bundleHash(job.glossary_json)
    || bundleHash(await readGlossarySnapshot(client,job.org_id,job.site_id))!==bundleHash(job.glossary_json))throw Error('Follow-up obsolete');
  return row;
}
const current=checkCaseFollowupClaim;
function verifyAudio(row,bytes) {
  const info=inspectWav(bytes);
  if(info.sha256!==row.sha256 || info.bytes!==row.bytes || info.durationSeconds!==row.duration_seconds)throw Error('Follow-up audio unavailable');
}
export async function processOneCaseFollowup(pool,adapter,storage,{schema='public',dataClass}={}) {
  available({adapter,dataClass});
  if(!storage || !['save','read','remove','exists'].every(key=>typeof storage[key]==='function'))throw Error('Follow-up generation unavailable');
  const job=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT * FROM case_followups f WHERE ((status='queued') OR (status='processing' AND lease_until<=clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM case_content_purges d WHERE d.case_id=f.case_id)
      AND ${dispatchPredicate('f',{provider:true})} ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
    if(!row || !await dispatchAllowed(client,row.org_id,{provider:true}))return null;
    if(row.attempts>=3){await client.query("UPDATE case_followups SET status='failed',lease_token=NULL,lease_until=NULL,error_code='interrupted' WHERE id=$1",[row.id]);return {...row,exhausted:true};}
    const token=randomUUID();await client.query(`UPDATE case_followups SET status='processing',attempts=attempts+1,lease_token=$2,
      lease_until=clock_timestamp()+interval '180 seconds',manifest_json=NULL,error_code=NULL WHERE id=$1`,[row.id,token]);
    return {...row,token};
  });
  if(!job)return false;if(job.exhausted)return true;
  try {
    const check=()=>domainTransaction(pool,schema,client=>current(client,job));
    let generationAdapter=adapter,operation=null,inputHash=null,provenance=null;
    if(typeof adapter.withJournal==='function') {
      const model=adapter.provenance[job.language==='en'?'speechModel':'textModel'];
      provenance=checkedFollowupProvenance(adapter.provenance,model,job.language);
      inputHash=caseFollowupInputHash(job,provenance);
      operation=await domainTransaction(pool,schema,async client=>{
        await current(client,job);return reserveProviderOperation(client,{orgId:job.org_id,kind:'case-followup',referenceId:job.id,
          claimToken:job.token,model,dataClass,maxRequests:job.language==='en'?1:3,inputHash,provenance});
      });
      generationAdapter=adapter.withJournal(providerRequestJournal(pool,operation,{schema}));
    }
    const bundle=await generateCaseFollowup({identity:identity(job),source:job.source_text,glossary:job.glossary_json,
      dataClass,adapter:generationAdapter,assertCurrent:check});
    const manifest=bundle.manifest,ref=manifest.audio;
    const staged=await domainTransaction(pool,schema,async client=>{
      await current(client,job);
      const row=(await client.query(`INSERT INTO case_followup_audio(id,request_id,org_id,site_id,job_lease,language,text_hash,sha256,bytes,duration_seconds,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'storing') RETURNING *`,
      [ref.id,job.id,job.org_id,job.site_id,job.token,ref.language,ref.textHash,ref.sha256,ref.bytes,ref.durationSeconds])).rows[0];
      await client.query('UPDATE case_followups SET manifest_json=$2 WHERE id=$1',[job.id,JSON.stringify(manifest)]);return row;
    });
    await check();
    // A lost conditional-save acknowledgement is resolved by exact private readback.
    try{await storage.save(staged,bundle.audio.bytes);}catch{/* The durable staging row owns any uncertain object. */}
    const bytes=Buffer.from(await storage.read(staged));verifyAudio(staged,bytes);
    checkedCaseFollowupBundle({manifest,audio:{id:ref.id,language:ref.language,textHash:ref.textHash,bytes}},manifest.dependencyHash);
    await domainTransaction(pool,schema,async client=>{
      const row=await current(client,job);
      if(bundleHash(row.manifest_json)!==bundleHash(manifest))throw Error('Follow-up obsolete');
      if(operation && (caseFollowupInputHash(row,provenance)!==inputHash || bundleHash(manifest.dependencies.provider)!==bundleHash(provenance)))throw Error('Follow-up provenance changed');
      const audio=(await client.query("SELECT * FROM case_followup_audio WHERE id=$1 AND job_lease=$2 AND state='storing' FOR UPDATE",[ref.id,job.token])).rows[0];
      if(!audio)throw Error('Follow-up obsolete');
      await client.query(`INSERT INTO case_messages(id,org_id,site_id,case_id,assignment_id,actor_type,actor_id,language,text,request_hash,created_at)
        VALUES($1,$2,$3,$4,$5,'staff',$6,$7,$8,$9,clock_timestamp())`,[job.id,job.org_id,job.site_id,job.case_id,job.assignment_id,job.actor_id,job.language,manifest.target.text,job.request_hash]);
      await client.query("UPDATE case_followup_audio SET state='attached' WHERE id=$1",[ref.id]);
      await client.query(`UPDATE case_followups SET status='delivered',delivered_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,
        provider_operation_id=$2,provider_input_hash=$3 WHERE id=$1`,[job.id,operation?.id ?? null,inputHash]);
      await domainAudit(client,author(job),'clarification.message',job.id);
    });
  }catch(error) {
    if(error.message==='Operational dispatch paused')return true;
    const code=error instanceof CaseFollowupError?error.code:'generation_failed';
    // Never compensate by deleting an object after an uncertain delivery commit.
    await domainTransaction(pool,schema,async client=>{
      if(!await dispatchAllowed(client,job.org_id,{provider:true}))return;
      await client.query(`UPDATE case_followups SET status='failed',lease_token=NULL,lease_until=NULL,error_code=$3
        WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp()`,[job.id,job.token,code]);
    });
  }
  return true;
}
export async function getCaseFollowupAudio(pool,session,caseId,messageId,storage,{schema='public'}={}) {
  caseMessageId(messageId);
  const load=()=>domainTransaction(pool,schema,async client=>{
    await scopedCase(client,session,caseId);
    const row=(await client.query(`SELECT a.* FROM case_followup_audio a JOIN case_followups f ON f.id=a.request_id
      WHERE f.id=$1 AND f.case_id=$2 AND f.org_id=$3 AND f.site_id=$4 AND f.status='delivered' AND a.state='attached'
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments x ON x.worker_id=d.worker_id WHERE x.id=f.assignment_id)
      AND NOT EXISTS(SELECT 1 FROM retention_policies p WHERE p.org_id=f.org_id AND p.site_id=f.site_id
        AND f.delivered_at<=clock_timestamp()-p.audio_days*interval '1 day')`,[messageId,caseId,session.org_id,session.site_id])).rows[0];
    if(!row)throw Error('Follow-up audio unavailable');return row;
  });
  const row=await load();let bytes;
  try{bytes=Buffer.from(await storage.read(row));verifyAudio(row,bytes);}catch{throw Error('Follow-up audio unavailable');}
  const after=await load();if(after.id!==row.id || after.sha256!==row.sha256)throw Error('Follow-up audio unavailable');return bytes;
}
export async function processOneCaseFollowupPurge(pool,storage,{schema='public'}={}) {
  const job=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT a.* FROM case_followup_audio a JOIN case_followups f ON f.id=a.request_id
      LEFT JOIN retention_policies p ON p.org_id=f.org_id AND p.site_id=f.site_id
      WHERE a.state<>'cleaned' AND (a.state<>'cleaning' OR a.cleanup_until<=clock_timestamp())
      AND NOT (f.status='processing' AND f.lease_token=a.job_lease AND f.lease_until>clock_timestamp())
      AND ((a.state='storing' AND (a.expires_at<=clock_timestamp() OR f.status='failed')
        AND NOT (f.status='processing' AND f.lease_token=a.job_lease AND f.lease_until>clock_timestamp()))
        OR (a.state IN ('attached','cleaning') AND f.delivered_at<=clock_timestamp()-p.audio_days*interval '1 day')
        OR a.state='cleaning' OR EXISTS(SELECT 1 FROM case_content_purges d WHERE d.case_id=f.case_id)
        OR EXISTS(SELECT 1 FROM worker_deletion_requests d JOIN assignments x ON x.worker_id=d.worker_id WHERE x.id=f.assignment_id))
      ORDER BY a.created_at,a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED`)).rows[0];
    if(!row)return null;const token=randomUUID();
    await client.query("UPDATE case_followup_audio SET state='cleaning',cleanup_token=$2,cleanup_until=clock_timestamp()+interval '90 seconds' WHERE id=$1",[row.id,token]);
    return {...row,token};
  });
  if(!job)return false;
  try {
    await storage.remove(job);if(await storage.exists(job)!==false)throw Error('Follow-up cleanup incomplete');
    await domainTransaction(pool,schema,async client=>{
      const row=(await client.query(`UPDATE case_followup_audio SET state='cleaned',cleanup_token=NULL,cleanup_until=NULL
        WHERE id=$1 AND state='cleaning' AND cleanup_token=$2 AND cleanup_until>clock_timestamp() RETURNING id`,[job.id,job.token])).rows[0];
      if(row)await domainAudit(client,{...job,principal_type:'system',principal_id:'followup-retention'},'clarification.audio.purged',job.id);
    });
  }catch{/* A reclaimable cleanup lease retains ownership; no false deletion completion. */}
  return true;
}
