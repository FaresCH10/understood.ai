import { randomUUID,createHash } from 'node:crypto';
import {preparationRequestInput,preparationRequestId,preparationReference,preparationRequestReceipt} from '../preparation-request-input.mjs';
import { syntheticPrepare } from '../domain.mjs';
import { syntheticInstructionPrepare } from '../instruction-prep.mjs';
import { domainTransaction,domainAudit,requirePrincipal,readySnapshot,requireActiveBriefing } from './domain.mjs';
import { draftInput,expectedRevision,copyDraftInput,checkDraftCopyReplay,archiveBriefingInput } from '../briefing-input.mjs';
import {checkedSyntheticReview} from '../briefing-input.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {checkedSyntheticGlossary,assertGlossaryCurrent} from '../glossary-input.mjs';
import {prepareLanguageBundle} from '../ai/prepared-bundle.mjs';
import {checkPreparationClaim,recordPreparationStage,stagePreparedBundle,attachPreparedBundle} from './generated-audio.mjs';
import {loadTargetRegeneration} from './regeneration.mjs';
import {appendPreparationStage,systemStage} from './preparation-progress.mjs';
import {preparationErrorCode} from '../preparation-progress.mjs';
import {readGenerationLanguages} from './settings.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
import {bindPreparationAuthority,checkPreparationAuthority} from './preparation-authority.mjs';
import {reserveProviderOperation,providerRequestJournal} from './provider-budget.mjs';
import {preparationOperationEvidence} from '../ai/preparation-provenance.mjs';
import {expiredBriefingContentMatches} from './briefing-retention.mjs';

export async function archiveBriefing(pool,session,id,input,{schema='public'}={}) {
  const change=archiveBriefingInput(input),requestJson=JSON.stringify(change);
  return domainTransaction(pool,schema,async(client)=>{
    await requirePrincipal(client,session,'staff');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`understood:archive:${schema}:${session.org_id}:${session.site_id}:${input.requestId}`]);
    const row=(await client.query('SELECT revision,next_version FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[id,session.org_id,session.site_id])).rows[0];
    if(!row) throw new Error('Briefing unavailable');
    const old=(await client.query('SELECT * FROM briefing_archives WHERE request_id=$1 AND org_id=$2 AND site_id=$3',[input.requestId,session.org_id,session.site_id])).rows[0];
    if(old) {
      const oldRequest=old.request_json;
      if(old.briefing_id!==id || JSON.stringify({revision:oldRequest.revision,nextVersion:oldRequest.nextVersion,reason:oldRequest.reason})!==requestJson) throw new Error('Briefing archive request conflict');
      return {id,state:'archived',occurredAt:old.occurred_at.toISOString(),closedPublicationIds:old.publication_ids_json,duplicate:true};
    }
    await requireActiveBriefing(client,session,id);
    if(row.revision!==change.revision || row.next_version!==change.nextVersion) throw new Error('Draft revision changed');
    const closed=(await client.query("SELECT id FROM publications WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND state='published' ORDER BY id",[id,session.org_id,session.site_id])).rows.map(row=>row.id);
    await client.query("UPDATE publications SET state='archived' WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND state='published'",[id,session.org_id,session.site_id]);
    await client.query("UPDATE jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='Briefing archived' WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND kind='prepare' AND status IN ('queued','processing')",[id,session.org_id,session.site_id]);
    await client.query("UPDATE briefings SET state=CASE WHEN state='processing' THEN 'failed' ELSE state END,updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND site_id=$3",[id,session.org_id,session.site_id]);
    const receipt=(await client.query('INSERT INTO briefing_archives(request_id,org_id,site_id,briefing_id,request_json,publication_ids_json,archived_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING occurred_at',[input.requestId,session.org_id,session.site_id,id,requestJson,JSON.stringify(closed),session.principal_id])).rows[0];
    await domainAudit(client,session,'briefing.archived',id);
    return {id,state:'archived',occurredAt:receipt.occurred_at.toISOString(),closedPublicationIds:closed,duplicate:false};
  });
}

export async function createDraft(pool,session,input,{schema='public'}={}) {
  return domainTransaction(pool,schema,client=>createDraftInTransaction(client,session,input,schema));
}

export async function createDraftInTransaction(client,session,input,schema) {
  const content=draftInput(input,'create');
  const requestHash=createHash('sha256').update(JSON.stringify(content)).digest('hex');
    await requirePrincipal(client,session,'staff');
    // One request ID is one draft even when the create acknowledgment is lost.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`understood:draft:${schema}:${input.requestId}`]);
    const receipt=(await client.query('SELECT briefing_id,request_hash FROM draft_creations WHERE request_id=$1 AND org_id=$2 AND site_id=$3',[input.requestId,session.org_id,session.site_id])).rows[0];
    if(receipt) {
      if(receipt.request_hash!==requestHash) throw new Error('Draft request conflict');
      return {id:receipt.briefing_id,state:'draft',revision:1,requestHash,duplicate:true};
    }
    const old=(await client.query('SELECT id,title,source,state,revision FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',[input.requestId,session.org_id,session.site_id])).rows[0];
    if (old) {
      if (old.title!==content.title || old.source!==content.source || content.generationLanguages!==undefined) throw new Error('Draft request conflict');
      return {id:old.id,state:old.state,revision:old.revision,duplicate:true};
    }
    await client.query(`INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES ($1,$2,$3,$4,$5,'draft')`,[input.requestId,session.org_id,session.site_id,content.title,content.source]);
    await client.query('INSERT INTO draft_creations(request_id,org_id,site_id,briefing_id,request_hash,requested_by,generation_languages_json) VALUES($1,$2,$3,$1,$4,$5,$6)',[input.requestId,session.org_id,session.site_id,requestHash,session.principal_id,content.generationLanguages?JSON.stringify(content.generationLanguages):null]);
    await domainAudit(client,session,'briefing.created',input.requestId);
    return {id:input.requestId,state:'draft',revision:1,requestHash,duplicate:false};
}

export async function editDraft(pool,session,briefingId,input,{schema='public'}={}) {
  const content=draftInput(input,'edit');
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT revision,title,source FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[briefingId,session.org_id,session.site_id])).rows[0];
    if (!row) throw new Error('Briefing unavailable');
    await requireActiveBriefing(client,session,briefingId);
    if (row.revision!==input.revision) throw new Error('Draft revision changed');
    if (row.title===content.title && row.source===content.source) return {id:briefingId,revision:row.revision,unchanged:true};
    await client.query(`UPDATE briefings SET title=$4,source=$5,revision=revision+1,state='draft',prepared_json=NULL,updated_at=clock_timestamp()
      WHERE id=$1 AND org_id=$2 AND site_id=$3`,[briefingId,session.org_id,session.site_id,content.title,content.source]);
    await client.query('DELETE FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[briefingId,session.org_id,session.site_id]);
    await client.query(`UPDATE jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='Obsolete draft revision'
      WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND kind='prepare' AND revision=$4 AND status IN ('queued','processing')`,[briefingId,session.org_id,session.site_id,row.revision]);
    await domainAudit(client,session,'briefing.edited',briefingId);
    return {id:briefingId,revision:row.revision+1,state:'draft',unchanged:false};
  });
}

export async function copyDraft(pool,session,id,input,{schema='public'}={}) {
  const change=copyDraftInput(input);
  return domainTransaction(pool,schema,async(client) => {
    await requirePrincipal(client,session,'staff');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`understood:draft:${schema}:${change.requestId}`]);
    const source=(await client.query('SELECT revision,source FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[id,session.org_id,session.site_id])).rows[0];
    if(!source) throw new Error('Briefing unavailable');
    const old=(await client.query('SELECT * FROM briefing_copies WHERE request_id=$1 AND org_id=$2 AND site_id=$3',[change.requestId,session.org_id,session.site_id])).rows[0];
    if(old) {
      if(old.title==='[Expired]' && await expiredBriefingContentMatches(client,old.copy_briefing_id,'briefing_copies',old.request_id,{title:change.title}))checkDraftCopyReplay({...old,title:change.title},id,change);
      else checkDraftCopyReplay(old,id,change);
      const row=(await client.query('SELECT id,state,revision FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',[old.copy_briefing_id,session.org_id,session.site_id])).rows[0];
      return {...row,duplicate:true};
    }
    if((await client.query('SELECT 1 FROM briefing_content_purges WHERE briefing_id=$1',[id])).rows.length)throw Error('Expired briefing content is unavailable');
    if(source.revision!==change.revision) throw new Error('Draft revision changed');
    const content=draftInput({requestId:change.requestId,title:change.title,source:source.source},'create');
    if((await client.query('SELECT id FROM briefings WHERE id=$1',[change.requestId])).rows.length) throw new Error('Draft copy request conflict');
    await client.query("INSERT INTO briefings(id,org_id,site_id,title,source,state) VALUES($1,$2,$3,$4,$5,'draft')",[change.requestId,session.org_id,session.site_id,content.title,content.source]);
    await client.query('INSERT INTO briefing_copies(request_id,org_id,site_id,source_briefing_id,source_revision,copy_briefing_id,title,requested_by) VALUES($1,$2,$3,$4,$5,$1,$6,$7)',[change.requestId,session.org_id,session.site_id,id,change.revision,content.title,session.principal_id]);
    await domainAudit(client,session,'briefing.copied',change.requestId);
    return {id:change.requestId,state:'draft',revision:1,duplicate:false};
  });
}

export async function queuePreparation(pool,session,briefingId,revision,{schema='public'}={}) {
  expectedRevision(revision);
  return domainTransaction(pool,schema,client=>queuePreparationInTransaction(client,session,briefingId,revision));
}
export async function queuePreparationInTransaction(client,session,briefingId,revision) {
    await requirePrincipal(client,session,'staff');
    const briefing=(await client.query('SELECT revision,state FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[briefingId,session.org_id,session.site_id])).rows[0];
    if (!briefing) throw new Error('Briefing unavailable');
    await requireActiveBriefing(client,session,briefingId);
    if (briefing.revision!==revision) throw new Error('Draft revision changed');
    const old=(await client.query(`SELECT id,status FROM jobs WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND revision=$4 AND kind='prepare' FOR UPDATE`,[briefingId,session.org_id,session.site_id,revision])).rows[0];
    if (briefing.state==='processing' && ['queued','processing'].includes(old?.status)) return {id:old.id,state:'processing',duplicate:true};
    if (!['draft','failed'].includes(briefing.state)) throw new Error('Draft cannot be processed now');
    const jobId=old?.id || randomUUID();
    await client.query(`INSERT INTO jobs(id,org_id,site_id,briefing_id,revision,kind,status,due_at) VALUES ($1,$2,$3,$4,$5,'prepare','queued',clock_timestamp())
      ON CONFLICT(briefing_id,revision,kind) DO UPDATE SET status='queued',attempts=0,due_at=clock_timestamp(),lease_until=NULL,lease_token=NULL,error=NULL`,[jobId,session.org_id,session.site_id,briefingId,revision]);
    await client.query(`UPDATE briefings SET state='processing',prepared_json=NULL,updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND site_id=$3`,[briefingId,session.org_id,session.site_id]);
    await bindPreparationAuthority(client,session,jobId);
    await domainAudit(client,session,'briefing.processing_requested',jobId);
    return {id:jobId,state:'processing',duplicate:false};
}

async function preparationContext(client,session,id) {
  await requirePrincipal(client,session,'staff');preparationReference(id);
  const row=(await client.query('SELECT revision,state FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[id,session.org_id,session.site_id])).rows[0];
  if(!row)throw Error('Briefing unavailable');
  await requireActiveBriefing(client,session,id);
  const job=(await client.query("SELECT id,status FROM jobs WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND revision=$4 AND kind='prepare' FOR UPDATE",[id,session.org_id,session.site_id,row.revision])).rows[0];
  const generation=job?(await client.query('SELECT count(*)::int AS n FROM preparation_requests WHERE job_id=$1',[job.id])).rows[0].n:0;
  return {briefingId:id,revision:row.revision,state:row.state,job:job?{...job,generation}:null};
}
export function getPreparationRequestContext(pool,session,id,{schema='public'}={}) {
  return domainTransaction(pool,schema,client=>preparationContext(client,session,id));
}
export function getPreparationRequestReceipt(pool,session,id,requestId,{schema='public'}={}) {
  preparationReference(id);preparationRequestId(requestId);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT * FROM preparation_requests WHERE request_id=$1 AND briefing_id=$2 AND org_id=$3 AND site_id=$4 AND requested_by=$5',[requestId,id,session.org_id,session.site_id,session.principal_id])).rows[0];
    return row?preparationRequestReceipt(row):{found:false};
  });
}
export function requestPreparation(pool,session,id,value,{schema='public'}={}) {
  const input=preparationRequestInput(id,value),{requestId,briefingId,...body}=input;
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`preparation-request:${requestId}`]);
    const saved=(await client.query('SELECT * FROM preparation_requests WHERE request_id=$1',[requestId])).rows[0];
    if(saved) {
      if(saved.org_id!==session.org_id || saved.site_id!==session.site_id || saved.requested_by!==session.principal_id
        || saved.briefing_id!==id || JSON.stringify(preparationRequestInput(saved.briefing_id,{...saved.request_json,requestId:saved.request_id}))!==JSON.stringify(input))throw Error('Preparation request conflict');
      return {...preparationRequestReceipt(saved).result,duplicate:true};
    }
    const context=await preparationContext(client,session,id);
    if(context.revision!==input.revision || (context.job?.id ?? null)!==input.jobId || (context.job?.generation ?? 0)!==input.generation
      || !['draft','failed'].includes(context.state) || context.job && context.job.status!=='failed')throw Error('Preparation request state changed');
    const result=await queuePreparationInTransaction(client,session,id,input.revision);
    const row=(await client.query('INSERT INTO preparation_requests(request_id,org_id,site_id,briefing_id,revision,job_id,generation,request_json,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[requestId,session.org_id,session.site_id,id,input.revision,result.id,input.generation,JSON.stringify(body),session.principal_id])).rows[0];
    return {...preparationRequestReceipt(row).result,duplicate:false};
  });
}

export async function processOnePreparation(pool,{schema='public',integrationMode,prepare=syntheticPrepare,adapter,storage,languages=['en','ar','ur']}={}) {
  if (integrationMode!=='synthetic') throw new Error('Live preparation artifact integration is unavailable');
  const job=await domainTransaction(pool,schema,async (client) => {
    const row=(await client.query(`SELECT * FROM jobs WHERE kind='prepare' AND ((status='queued' AND due_at<=clock_timestamp())
      OR (status='processing' AND lease_until<=clock_timestamp())) AND ${dispatchPredicate('jobs',{provider:true})}
      ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row || !await dispatchAllowed(client,row.org_id,{provider:true})) return null;
    const token=randomUUID();
    await client.query(`UPDATE jobs SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '90 seconds',error=NULL WHERE id=$1`,[row.id,token]);
    await appendPreparationStage(client,{...row,token},systemStage('worker','started'));
    return {...row,attempts:row.attempts+1,token};
  });
  if (!job) return false;
  try {
    if (job.attempts>3) throw new Error('Preparation interrupted too many times');
    const briefing=await domainTransaction(pool,schema,async (client) => (await client.query(`SELECT b.source,b.title,b.state,b.revision,
      s.request_id AS instruction_request_id,s.response_mode,s.delivery_mode FROM briefings b
      LEFT JOIN instruction_sends s ON s.briefing_id=b.id AND s.org_id=b.org_id AND s.site_id=b.site_id
      WHERE b.id=$1 AND b.org_id=$2 AND b.site_id=$3`,[job.briefing_id,job.org_id,job.site_id])).rows[0]);
    if (!briefing || briefing.state!=='processing' || briefing.revision!==job.revision) throw new Error('Obsolete draft revision');
    const review=await domainTransaction(pool,schema,async client=>(await client.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[job.briefing_id,job.org_id,job.site_id])).rows[0]?.content_json);
    if(review && review.revision!==job.revision) throw new Error('Obsolete draft review');
    const glossary=await domainTransaction(pool,schema,client=>readGlossarySnapshot(client,job.org_id,job.site_id));
    const intent=await domainTransaction(pool,schema,client=>loadTargetRegeneration(client,job));
    const targets=intent ? intent.evidence.manifest.dependencies.languages : await domainTransaction(pool,schema,client=>readGenerationLanguages(client,job.org_id,job.site_id,languages,job.briefing_id));
    if(intent && !targets.every(language=>languages.includes(language)))throw Error('Regeneration language configuration changed');
    const instruction=briefing?.instruction_request_id ? {response_mode:briefing.response_mode,delivery_mode:briefing.delivery_mode} : null;
    if(instruction && adapter)throw Error('Instruction sends require the synthetic instruction processor');
    if(adapter) {
      const input={source:briefing.source,revision:job.revision,languages:targets,review:review ?? null,glossary};
      if(typeof adapter.permitsPreparation==='function' && !adapter.permitsPreparation(input))throw Error('Preparation input is not an allowlisted synthetic fixture');
      let generationAdapter=adapter,currentStage=null,providerOperations=null;
      if(typeof adapter.withJournal==='function') {
        if(adapter.provenance?.dataClass!=='synthetic' || typeof adapter.permitsPreparation!=='function')throw Error('Preparation provider provenance unavailable');
        await domainTransaction(pool,schema,client=>checkPreparationAuthority(client,job,{required:true}));
        generationAdapter={...adapter};providerOperations=[];
        for(const method of ['prepare','checkPreparation','translate','checkTranslation','speech'])generationAdapter[method]=async(...args)=>{
          const evidence=preparationOperationEvidence(job,input,method,args,currentStage,adapter.provenance);
          const operation=await domainTransaction(pool,schema,client=>reserveProviderOperation(client,{orgId:job.org_id,kind:'preparation',referenceId:job.id,
            claimToken:job.token,model:evidence.provenance.model,dataClass:'synthetic',maxRequests:1,...evidence}));
          providerOperations.push(operation.id);
          return adapter.withJournal(providerRequestJournal(pool,operation,{schema}))[method](...args);
        };
      }
      let regeneration=null;
      if(intent) {
        const audio=[];
        for(const row of intent.evidence.audio) {
          await checkPreparationClaim(pool,job,{source:briefing.source,review:review ?? null,glossary},{schema});
          audio.push({id:row.id,language:row.language,textHash:row.text_hash,bytes:Buffer.from(await storage.read(row))});
        }
        regeneration={kind:intent.row.request_json.kind,language:intent.row.request_json.language,
          review:intent.row.baseline_review_json,bundle:{manifest:intent.evidence.manifest,audio}};
      }
      const bundle=await prepareLanguageBundle({source:briefing.source,revision:job.revision,languages:targets,review:review ?? null,glossary,
        dataClass:'synthetic',adapter:generationAdapter,regeneration,assertCurrent:()=>checkPreparationClaim(pool,job,{source:briefing.source,review:review ?? null,glossary},{schema}),
        onStage:async event=>{
          await recordPreparationStage(pool,job,{source:briefing.source,review:review ?? null,glossary},event,{schema});
          currentStage=event.state==='started'?{...event}:null;
        }});
      const bundleId=randomUUID();
      await stagePreparedBundle(pool,job,bundle,storage,{schema,bundleId,providerOperations});
      await attachPreparedBundle(pool,job,bundleId,storage,{schema});
      return true;
    }
    if(intent) throw Error('Generated target regeneration requires its configured adapter');
    const base=instruction
      ? syntheticInstructionPrepare({source:briefing.source,title:briefing.title},instruction)
      : checkedSyntheticReview(await prepare(briefing.source),review);
    const prepared=checkedSyntheticGlossary(base,glossary);
    prepared.languages=Object.fromEntries(targets.map(language=>[language,prepared.languages[language]]));
    readySnapshot({...briefing,state:'ready',prepared_json:prepared},targets.map((language) => ({language})),integrationMode,
      instruction ? {responseMode:instruction.response_mode,deliveryMode:instruction.delivery_mode} : undefined);
    await domainTransaction(pool,schema,async (client) => {
      if(!await dispatchAllowed(client,job.org_id,{provider:true}))return;
      await checkPreparationAuthority(client,job);
      const draft=(await client.query('SELECT state,revision FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[job.briefing_id,job.org_id,job.site_id])).rows[0];
      const current=(await client.query(`SELECT id FROM jobs WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,[job.id,job.token])).rows[0];
      if (!current) return;
      if (!draft || draft.revision!==job.revision || draft.state!=='processing') {
        await client.query(`UPDATE jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='Obsolete draft revision' WHERE id=$1`,[job.id]); return;
      }
      assertGlossaryCurrent(prepared,await readGlossarySnapshot(client,job.org_id,job.site_id));
      await client.query(`UPDATE briefings SET prepared_json=$4,state='ready',updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND site_id=$3`,[job.briefing_id,job.org_id,job.site_id,JSON.stringify(prepared)]);
      await client.query(`UPDATE jobs SET status='ready',lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1`,[job.id]);
      await appendPreparationStage(client,job,systemStage('worker','completed'));
      await domainAudit(client,{...job,principal_type:'system',principal_id:'synthetic-worker'},'briefing.prepared',job.briefing_id);
    });
  } catch(error) {
    if(error.message==='Operational dispatch paused')return true;
    await domainTransaction(pool,schema,async (client) => {
      if(!await dispatchAllowed(client,job.org_id,{provider:true}))return;
      // Lock draft before job, like editing/queueing/completion, so retries do not introduce a lock-order cycle.
      await client.query('SELECT id FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[job.briefing_id,job.org_id,job.site_id]);
      const current=(await client.query(`SELECT id FROM jobs WHERE id=$1 AND status='processing' AND lease_token=$2 AND lease_until>clock_timestamp() FOR UPDATE`,[job.id,job.token])).rows[0];
      if (!current) return;
      await appendPreparationStage(client,job,systemStage('worker','failed',preparationErrorCode(error)));
      await client.query(`UPDATE jobs SET status='failed',lease_token=NULL,lease_until=NULL,error='Synthetic preparation failed' WHERE id=$1`,[job.id]);
      await client.query(`UPDATE briefings SET state='failed',updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND site_id=$3 AND revision=$4 AND state='processing'`,[job.briefing_id,job.org_id,job.site_id,job.revision]);
    });
  }
  return true;
}
