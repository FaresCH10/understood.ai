import {requireWritableEntitlement} from './entitlements.mjs';
import {randomUUID} from 'node:crypto';
import {domainTransaction,requirePrincipal} from './domain.mjs';
import {dispatchAllowed} from './operations-gates.mjs';

function presentationJobSession(row){
  const principal={...row.authority_json,principal_type:'worker',principal_id:row.worker_id,org_id:row.org_id,site_id:row.site_id};
  // Password changes revoke the bound session; the worker must not read credential hashes.
  if(principal.token_hash&&!principal.grant_id)delete principal.access_mode;
  return principal;
}

export async function queuePresentationJob(client,id,session){
  const authority={...Object.fromEntries(['access_mode','token_hash','grant_id','credential_revision'].filter(key=>session?.[key]!==undefined).map(key=>[key,session[key]]))};
  await client.query(`INSERT INTO presentation_translation_jobs(id,authority_json) VALUES($1,$2)
    ON CONFLICT(id) DO UPDATE SET state='queued',authority_json=EXCLUDED.authority_json,error_code=NULL,updated_at=clock_timestamp()
      WHERE presentation_translation_jobs.state='failed' AND presentation_translation_jobs.attempts<3`,[id,JSON.stringify(authority)]);
}
export async function currentPresentationProviderClaim(client,id,claimToken,orgId,inputHash){
  const row=(await client.query(`SELECT p.*,j.authority_json,w.language AS approved_language FROM presentation_translation_jobs j
    JOIN presentation_artifacts p ON p.id=j.id JOIN workers w ON w.id=p.worker_id AND w.org_id=p.org_id AND w.site_id=p.site_id
    JOIN assignments a ON a.id=p.assignment_id AND a.org_id=p.org_id AND a.site_id=p.site_id
    JOIN publications pub ON pub.id=p.publication_id AND pub.org_id=p.org_id AND pub.site_id=p.site_id
    WHERE j.id=$1 AND j.lease_token=$2 AND p.org_id=$3 AND p.source_hash=$4 AND j.state='processing'
      AND j.lease_until>clock_timestamp() AND w.active AND w.language=p.target_language AND p.status IN ('pending','ready')
      AND p.text IS DISTINCT FROM '[Deleted]' AND p.text IS DISTINCT FROM '[Expired]'
      AND NOT EXISTS(SELECT 1 FROM briefing_content_purges b WHERE b.briefing_id=pub.briefing_id AND b.org_id=p.org_id AND b.site_id=p.site_id)`,[id,claimToken,orgId,inputHash])).rows[0];
  if(!row)throw Error('Presentation provider authority changed');
  await requirePrincipal(client,presentationJobSession(row),'worker');
  await requireWritableEntitlement(client,row.org_id);
  await client.query("UPDATE presentation_translation_jobs SET lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$1 AND lease_token=$2",[id,claimToken]);
  return row;
}
export async function processOnePresentation(pool,adapter,{schema='public'}={}){
  if(!adapter?.withJournal||adapter.provenance?.dataClass!=='real')return false;
  const job=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT j.*,p.org_id,p.site_id,p.worker_id,p.assignment_id,p.source_kind,p.source_id,p.source_hash
      FROM presentation_translation_jobs j JOIN presentation_artifacts p ON p.id=j.id
      WHERE (j.state='queued' AND j.retry_at<=clock_timestamp() OR j.state='processing' AND j.lease_until<=clock_timestamp())
      ORDER BY j.updated_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`)).rows[0];
    if(!row||!await dispatchAllowed(client,row.org_id,{provider:true}))return null;
    if(row.attempts>=3){await client.query("UPDATE presentation_translation_jobs SET state='failed',lease_token=NULL,lease_until=NULL,error_code='attempts_exhausted' WHERE id=$1",[row.id]);return {...row,exhausted:true};}
    const token=randomUUID();await client.query("UPDATE presentation_translation_jobs SET state='processing',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE id=$1",[row.id,token]);return {...row,token};
  });
  if(!job)return false;if(job.exhausted)return true;
  try{
    const {reserveProviderOperation,providerRequestJournal}=await import('./provider-budget.mjs');
    const {createPresentation}=await import('./presentations.mjs');
    const call=async(method,...args)=>{
      const provenance={adapter:adapter.provenance.adapter,dataClass:'real',model:adapter.provenance.textModel,promptVersion:'gemini-presentation-v1',schemaVersion:'gemini-generation-v4'};
      let operation;try{operation=await domainTransaction(pool,schema,client=>reserveProviderOperation(client,{orgId:job.org_id,kind:'presentation',referenceId:job.id,claimToken:job.token,model:provenance.model,dataClass:'real',maxRequests:1,inputHash:job.source_hash,provenance}));}catch(error){if(/quota is closed|quota reached|dispatch paused|Workspace is read-only/i.test(error.message))throw Object.assign(Error('Presentation generation deferred'),{code:'presentation_deferred'});throw error;}
      return adapter.withJournal(providerRequestJournal(pool,operation,{schema}))[method](...args);
    };
    const translator={capabilities:adapter.capabilities,async translate({sourceLanguage,targetLanguage,content,kind}){
      const source=kind==='answer'?{title:'Worker answer',text:content.text,question:'What did the worker say?'}:content;
      const translated=await call('translate',source,targetLanguage);
      await call('checkTranslation',source,translated,targetLanguage);
      return {provider:adapter.provenance.adapter,live:true,content:kind==='answer'?{text:translated.text}:translated};
    }};
    await domainTransaction(pool,schema,client=>currentPresentationProviderClaim(client,job.id,job.token,job.org_id,job.source_hash));
    const result=await createPresentation(pool,presentationJobSession(job),job.assignment_id,
      {requestId:job.id,sourceKind:job.source_kind,...(job.source_kind==='answer'?{sourceId:job.source_id}:{})},{schema,translator});
    await domainTransaction(pool,schema,client=>client.query("UPDATE presentation_translation_jobs SET state=$3,lease_token=NULL,lease_until=NULL,error_code=$4,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND state='processing'",[job.id,job.token,result.status==='ready'?'complete':'failed',result.status==='ready'?null:'translation_unavailable']));
  }catch(error){
    if(error.code==='presentation_deferred'){await domainTransaction(pool,schema,client=>client.query("UPDATE presentation_translation_jobs SET state='queued',attempts=GREATEST(0,attempts-1),lease_token=NULL,lease_until=NULL,retry_at=clock_timestamp()+interval '60 seconds',error_code='generation_paused',updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND state='processing'",[job.id,job.token]));return true;}
    await domainTransaction(pool,schema,client=>client.query("UPDATE presentation_translation_jobs SET state='failed',lease_token=NULL,lease_until=NULL,error_code='translation_failed',updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND state='processing'",[job.id,job.token]));
  }
  return true;
}
