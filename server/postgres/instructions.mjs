import {randomUUID} from 'node:crypto';
import {domainAudit,domainTransaction,publishInTransaction,requirePrincipal} from './domain.mjs';
import {createDraftInTransaction,queuePreparationInTransaction} from './preparation.mjs';
import {instructionInput} from '../instructions.mjs';
import {generationLanguages} from '../settings-input.mjs';
import {WORKER_LANGUAGE_CODES} from '../languages.mjs';
import {generatedBundleEvidence,verifyGeneratedAudio} from './generated-audio.mjs';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {groupedUndelivered,recipientDeliveryReadiness} from '../delivery-readiness.mjs';
import {deliveryContent,deliveryContentHash,deliveryStateCounts,instructionRetryInput} from '../instruction-deliveries.mjs';
import {queuePublicationReminders} from './reminders.mjs';
import {entitlementSummary} from '../entitlement-model.mjs';
import {readEntitlement,requireWritableEntitlement} from './entitlements.mjs';
import {recordWorkerEvent,staffAuditOnce} from './notification-events.mjs';

const uuid=(value)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const iso=(value)=>value instanceof Date ? value.toISOString() : value;
const SUPPORTED_ROLES=['owner','supervisor'];

async function nowOf(client) {
  return (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
}

function requestMatches(saved,request) {
  return saved?.title===request.title && saved?.source===request.source
    && saved?.responseMode===request.responseMode && saved?.deliveryMode===request.deliveryMode
    && saved?.audience?.type===request.audience.type
    && (saved?.audience?.crewId ?? null)===(request.audience.crewId ?? null)
    && (saved?.dueAt ?? null)===(request.dueAt ?? null)
    && (saved?.reminderMinutes ?? 0)===(request.reminderMinutes ?? 0)
    && (saved?.sourceHash===undefined || saved.sourceHash===request.sourceHash);
}

async function deliveryRows(client,requestId) {
  return (await client.query('SELECT * FROM instruction_deliveries WHERE request_id=$1 ORDER BY worker_id',[requestId])).rows;
}

async function sendView(client,row,duplicate) {
  const audience=row.audience_json,request=row.request_json;
  const deliveries=await deliveryRows(client,row.request_id);
  const states=deliveries.length ? deliveryStateCounts(deliveries) : null;
  const retryCandidates=deliveries.filter((delivery)=>['blocked','failed'].includes(delivery.state) && delivery.reason!=='content_expired');
  return {requestId:row.request_id,briefingId:row.briefing_id,state:row.state,
    responseMode:row.response_mode,deliveryMode:row.delivery_mode,sourceHash:request.sourceHash ?? null,
    dueAt:request.dueAt ?? null,reminderMinutes:request.reminderMinutes ?? null,
    audience:{type:audience.type,count:row.audience_count,...(audience.crewId?{crewId:audience.crewId}:{})},
    delivered:row.delivered,undelivered:row.undelivered,undeliveredReasons:row.undelivered_json,
    deliveryStates:states,
    retryable:['published','failed'].includes(row.state) && !!states && retryCandidates.some((delivery)=>delivery.attempts<3)
      && (!request.dueAt || Date.parse(request.dueAt)>Date.now()),
    publicationId:row.publication_id,error:row.error,duplicate};
}

async function audienceWorkers(client,session,audience) {
  if(audience.type==='crew') {
    const crew=(await client.query('SELECT id,name FROM crews WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true',
      [audience.crewId,session.org_id,session.site_id])).rows[0];
    if(!crew) throw new Error('Crew unavailable');
    return (await client.query(`SELECT w.id,w.language FROM workers w
      JOIN crew_memberships cm ON cm.worker_id=w.id AND cm.org_id=w.org_id AND cm.site_id=w.site_id
      WHERE w.org_id=$1 AND w.site_id=$2 AND w.active=true AND w.language_selection_required=false AND cm.crew_id=$3
      ORDER BY w.code,w.id`,[session.org_id,session.site_id,audience.crewId])).rows;
  }
  return (await client.query(`SELECT id,language FROM workers
    WHERE org_id=$1 AND site_id=$2 AND active=true AND language_selection_required=false ORDER BY code,id`,
  [session.org_id,session.site_id])).rows;
}

async function insertDeliveries(client,requestId,row,workers,now) {
  if(!workers.length) return;
  await client.query(`INSERT INTO instruction_deliveries
    (request_id,org_id,site_id,worker_id,language,state,reason,attempts,assignment_id,content_json,content_hash,updated_at)
    SELECT $1,$2,$3,unnest($4::text[]),unnest($5::text[]),'preparing',NULL,0,NULL,NULL,NULL,$6`,
  [requestId,row.org_id,row.site_id,workers.map((worker)=>worker.id),workers.map((worker)=>worker.language),now]);
}

async function backfillDeliveries(client,row,now) {
  if((await client.query('SELECT 1 FROM instruction_deliveries WHERE request_id=$1 LIMIT 1',[row.request_id])).rows.length) return;
  await insertDeliveries(client,row.request_id,row,row.audience_json.workers,now);
}

function groupedFromDeliveries(deliveries) {
  return groupedUndelivered(deliveries.filter((delivery)=>delivery.state!=='available' && delivery.reason)
    .map((delivery)=>({reason:delivery.reason,language:delivery.language})));
}

async function syncSendCounts(client,row,{error=null,state=row.state,publicationId=row.publication_id,now}={}) {
  const deliveries=await deliveryRows(client,row.request_id);
  const available=deliveries.filter((delivery)=>delivery.state==='available').length;
  const undelivered=deliveries.length-available,grouped=groupedFromDeliveries(deliveries);
  now=now ?? await nowOf(client);
  return (await client.query(`UPDATE instruction_sends SET state=$1,publication_id=$2,delivered=$3,undelivered=$4,
    undelivered_json=$5::jsonb,error=$6,updated_at=$7 WHERE request_id=$8 AND org_id=$9 AND site_id=$10 RETURNING *`,
  [state,publicationId,available,undelivered,JSON.stringify(grouped),error,now,row.request_id,row.org_id,row.site_id])).rows[0];
}

async function settle(client,requestId,workerId,state,reason,now) {
  await client.query(`UPDATE instruction_deliveries SET state=$1,reason=$2,updated_at=$3
    WHERE request_id=$4 AND worker_id=$5 AND state='preparing'`,[state,reason,now,requestId,workerId]);
}

async function failPreparingSend(client,row,error,reason,now) {
  await client.query(`UPDATE instruction_deliveries SET state='failed',reason=$1,updated_at=$2
    WHERE request_id=$3 AND state='preparing'`,[reason,now,row.request_id]);
  return syncSendCounts(client,row,{state:'failed',publicationId:null,error,now});
}

async function settleReadOnly(client,row,{published,now}) {
  const summary=entitlementSummary(await readEntitlement(client,row.org_id),{now:now instanceof Date?now.getTime():Date.parse(now)});
  if(summary.writeAllowed) return null;
  await client.query(`UPDATE instruction_deliveries SET state='blocked',reason='workspace_read_only',updated_at=$1
    WHERE request_id=$2 AND state='preparing'`,[now,row.request_id]);
  return syncSendCounts(client,row,{state:published?'published':'failed',publicationId:published?row.publication_id:null,
    error:'Workspace is read-only. Delivery is waiting for activation.',now});
}

async function workerDeletionPending(client,orgId,workerId) {
  return (await client.query('SELECT 1 FROM worker_deletion_requests WHERE worker_id=$1 AND org_id=$2 LIMIT 1',
    [workerId,orgId])).rows.length>0;
}

async function briefingContentExpired(client,briefingId) {
  return (await client.query('SELECT 1 FROM briefing_content_purges WHERE briefing_id=$1 LIMIT 1',[briefingId])).rows.length>0;
}

async function settleExpired(client,row) {
  const now=await nowOf(client);
  await client.query(`UPDATE instruction_deliveries SET state='blocked',reason='content_expired',updated_at=$1
    WHERE request_id=$2 AND state='preparing'`,[now,row.request_id]);
  const current=(await client.query('SELECT * FROM instruction_sends WHERE request_id=$1',[row.request_id])).rows[0] ?? row;
  return syncSendCounts(client,current,{...(current.state==='preparing'?{state:'failed',publicationId:null,
    error:'Briefing content expired.'}:{}),now});
}

async function actorSession(client,row,principalId=row.requested_by) {
  const staff=(await client.query('SELECT role,active FROM staff WHERE id=$1 AND org_id=$2 AND site_id=$3',
    [principalId,row.org_id,row.site_id])).rows[0];
  if(!staff || !staff.active || !SUPPORTED_ROLES.includes(staff.role)) return null;
  return {principal_type:'staff',principal_id:principalId,org_id:row.org_id,site_id:row.site_id,role:staff.role};
}

// Private object reads must happen outside row-lock transactions. Publication
// subsequently rechecks the exact snapshot, principal and generated journal.
async function instructionAudioPreflight(pool,session,requestId,{schema='public',storage,integrationMode='synthetic'}={}) {
  const loaded=await domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query(`SELECT b.id,b.state,b.prepared_json FROM instruction_sends s JOIN briefings b
      ON b.id=s.briefing_id AND b.org_id=s.org_id AND b.site_id=s.site_id
      WHERE s.request_id=$1 AND s.org_id=$2 AND s.site_id=$3`,[requestId,session.org_id,session.site_id])).rows[0];
    if(!row || row.state!=='ready' || !row.prepared_json?.artifactBundle)return null;
    return {snapshotHash:bundleHash(row.prepared_json),evidence:await generatedBundleEvidence(client,{...session,briefing_id:row.id},row.prepared_json)};
  });
  if(loaded)await verifyGeneratedAudio(loaded.evidence,storage);
  return loaded;
}

async function publishSend(client,session,row,briefing,request,deliverable,preflight,integrationMode) {
  const published=await publishInTransaction(client,session,row.briefing_id,{
    requestId:row.publication_request_id,revision:briefing.revision,nextVersion:briefing.next_version,
    workerIds:deliverable.map((worker)=>worker.id),
    ...(request.dueAt?{dueAt:request.dueAt}:{}),...(request.reminderMinutes?{reminderMinutes:request.reminderMinutes}:{}),
  },{integrationMode,preflight,modes:{responseMode:row.response_mode,deliveryMode:row.delivery_mode}});
  const assignments=(await client.query('SELECT id,worker_id FROM assignments WHERE publication_id=$1 AND org_id=$2 AND site_id=$3',
    [published.id,session.org_id,session.site_id])).rows;
  const assignmentByWorker=new Map(assignments.map((assignment)=>[assignment.worker_id,assignment.id]));
  for(const worker of deliverable) {
    const assignmentId=assignmentByWorker.get(worker.id);
    if(!assignmentId) throw new Error('Instruction delivery unavailable');
    const content=briefing.prepared_json.languages[worker.language];
    await client.query(`UPDATE instruction_deliveries SET state='available',reason=NULL,assignment_id=$1,content_hash=$2,updated_at=$3
      WHERE request_id=$4 AND worker_id=$5 AND state='preparing'`,[assignmentId,
      deliveryContentHash(worker.language,content,{responseMode:row.response_mode,deliveryMode:row.delivery_mode}),
      await nowOf(client),row.request_id,worker.id]);
  }
  return published;
}

async function completeSend(client,session,row,preflight=null,integrationMode='synthetic') {
  if(await briefingContentExpired(client,row.briefing_id)) return {updated:await settleExpired(client,row),released:0};
  const briefing=(await client.query('SELECT * FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',
    [row.briefing_id,session.org_id,session.site_id])).rows[0];
  if(!briefing) throw new Error('Instruction unavailable');
  const readOnly=await settleReadOnly(client,row,{published:false,now:await nowOf(client)});
  if(readOnly) return {updated:readOnly,released:0};
  if(briefing.state==='failed') {
    const job=(await client.query("SELECT error FROM jobs WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND kind='prepare' ORDER BY created_at DESC LIMIT 1",
      [briefing.id,session.org_id,session.site_id])).rows[0];
    const error=String(job?.error || 'Instruction preparation failed').slice(0,300);
    const updated=await failPreparingSend(client,row,error,'preparation_failed',await nowOf(client));
    return {updated,released:0};
  }
  if(briefing.state!=='ready') return {updated:row,released:0};
  const prepared=briefing.prepared_json;
  if(!prepared || typeof prepared!=='object' || Array.isArray(prepared)) throw new Error('Instruction preparation unavailable');
  const request=row.request_json;
  if(request.dueAt && Date.parse(request.dueAt)<=Date.now()) {
    const now=await nowOf(client);
    await client.query(`UPDATE instruction_deliveries SET state='blocked',reason='deadline_passed',updated_at=$1
      WHERE request_id=$2 AND state='preparing'`,[now,row.request_id]);
    const updated=await syncSendCounts(client,row,{state:'failed',publicationId:null,
      error:'Instruction deadline passed before delivery.',now});
    return {updated,released:0};
  }
  const deliveries=await deliveryRows(client,row.request_id);
  const now=await nowOf(client),deliverable=[];
  for(const delivery of deliveries) {
    if(delivery.state!=='preparing') continue;
    const worker=(await client.query('SELECT id,language,active,language_selection_required::int AS required FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3',
      [delivery.worker_id,session.org_id,session.site_id])).rows[0];
    if(!worker || !worker.active) {await settle(client,row.request_id,delivery.worker_id,'blocked','worker_inactive',now);continue;}
    if(await workerDeletionPending(client,session.org_id,delivery.worker_id)) {await settle(client,row.request_id,delivery.worker_id,'blocked','worker_deletion',now);continue;}
    if(worker.required) {await settle(client,row.request_id,delivery.worker_id,'blocked','language_not_selected',now);continue;}
    if(worker.language!==delivery.language) {await settle(client,row.request_id,delivery.worker_id,'blocked','language_changed',now);continue;}
    const readiness=recipientDeliveryReadiness(prepared,{...worker,language:delivery.language},
      {responseMode:row.response_mode,deliveryMode:row.delivery_mode});
    if(!readiness.delivery) {await settle(client,row.request_id,delivery.worker_id,'failed',readiness.reason,now);continue;}
    deliverable.push(worker);
  }
  if(!deliverable.length) {
    const updated=await syncSendCounts(client,row,{state:'failed',publicationId:null,
      error:'No recipient has prepared content in their language yet.',now:await nowOf(client)});
    return {updated,released:0};
  }
  const published=await publishSend(client,session,row,briefing,request,deliverable,preflight,integrationMode);
  const updated=await syncSendCounts(client,row,{state:'published',publicationId:published.id,now:await nowOf(client)});
  await domainAudit(client,session,'instruction.send_published',row.request_id);
  if(updated.undelivered>0) await staffAuditOnce(client,{orgId:session.org_id,siteId:session.site_id,action:'instruction.send_incomplete',objectId:row.request_id});
  return {updated,released:deliverable.length};
}

async function reconcilePublished(client,session,row) {
  if(await briefingContentExpired(client,row.briefing_id)) return {updated:await settleExpired(client,row),released:0};
  const publication=(await client.query('SELECT id,state,snapshot_json,published_at FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3 AND briefing_id=$4',
    [row.publication_id,session.org_id,session.site_id,row.briefing_id])).rows[0];
  let now=await nowOf(client);
  if(!publication || publication.state!=='published') {
    await client.query(`UPDATE instruction_deliveries SET state='failed',reason='publication_unavailable',updated_at=$1
      WHERE request_id=$2 AND state='preparing'`,[now,row.request_id]);
    return {updated:await syncSendCounts(client,row,{now}),released:0};
  }
  const readOnly=await settleReadOnly(client,row,{published:true,now});
  if(readOnly) return {updated:readOnly,released:0};
  const request=row.request_json,snapshot=publication.snapshot_json;
  const briefing=(await client.query('SELECT * FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',
    [row.briefing_id,session.org_id,session.site_id])).rows[0];
  if(briefing?.state==='failed') {
    await client.query(`UPDATE instruction_deliveries SET state='failed',reason='preparation_failed',updated_at=$1
      WHERE request_id=$2 AND state='preparing'`,[now,row.request_id]);
    return {updated:await syncSendCounts(client,row,{now}),released:0};
  }
  let prepared=null;
  if(briefing?.prepared_json) {
    prepared=briefing.prepared_json;
    if(prepared?.source!==request.source) prepared=null;
  }
  const proceeding=briefing?.state==='processing' || briefing?.state==='draft';
  let released=0;
  for(const delivery of await deliveryRows(client,row.request_id)) {
    if(delivery.state!=='preparing') continue;
    const worker=(await client.query('SELECT id,language,active,language_selection_required::int AS required FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3',
      [delivery.worker_id,session.org_id,session.site_id])).rows[0];
    if(!worker || !worker.active) {await settle(client,row.request_id,delivery.worker_id,'blocked','worker_inactive',now);continue;}
    if(await workerDeletionPending(client,session.org_id,delivery.worker_id)) {await settle(client,row.request_id,delivery.worker_id,'blocked','worker_deletion',now);continue;}
    if(worker.required) {await settle(client,row.request_id,delivery.worker_id,'blocked','language_not_selected',now);continue;}
    if(worker.language!==delivery.language) {await settle(client,row.request_id,delivery.worker_id,'blocked','language_changed',now);continue;}
    if(request.dueAt && Date.parse(request.dueAt)<=Date.now()) {await settle(client,row.request_id,delivery.worker_id,'blocked','deadline_passed',now);continue;}
    const snapshotContent=snapshot.languages?.[delivery.language];
    // Generated speech belongs to the exact frozen publication bundle. A later
    // bundle cannot lend audio or a different answer key to that publication.
    const lateContent=snapshot.artifactBundle?null:prepared?.languages?.[delivery.language];
    const content=snapshotContent || lateContent;
    const readiness=recipientDeliveryReadiness(snapshotContent || snapshot.artifactBundle ? snapshot : prepared,{...worker,language:delivery.language},
      {responseMode:row.response_mode,deliveryMode:row.delivery_mode});
    if(!readiness.delivery) {
      if(!proceeding) await settle(client,row.request_id,delivery.worker_id,'failed',readiness.reason,now);
      continue;
    }
    if(!content) continue;
    const assignmentId=randomUUID();
    await client.query(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,language)
      VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7)`,
    [assignmentId,session.org_id,session.site_id,publication.id,worker.id,request.dueAt ?? null,delivery.language]);
    await client.query(`INSERT INTO publication_report_audience(assignment_id,org_id,site_id,publication_id,crew_id,crew_name)
      SELECT a.id,a.org_id,a.site_id,a.publication_id,c.id,c.name FROM assignments a
      LEFT JOIN crew_memberships m ON m.worker_id=a.worker_id AND m.org_id=a.org_id AND m.site_id=a.site_id
      LEFT JOIN crews c ON c.id=m.crew_id AND c.org_id=a.org_id AND c.site_id=a.site_id WHERE a.id=$1
      ON CONFLICT(assignment_id) DO NOTHING`,[assignmentId]);
    const late=!snapshotContent && !!lateContent;
    await client.query(`UPDATE instruction_deliveries SET state='available',reason=NULL,assignment_id=$1,content_json=$2::jsonb,content_hash=$3,updated_at=$4
      WHERE request_id=$5 AND worker_id=$6 AND state='preparing'`,[assignmentId,
      late?JSON.stringify(deliveryContent(lateContent)):null,
      deliveryContentHash(delivery.language,content,{responseMode:row.response_mode,deliveryMode:row.delivery_mode}),
      await nowOf(client),row.request_id,worker.id]);
    await recordWorkerEvent(client,{orgId:session.org_id,siteId:session.site_id,workerId:worker.id,kind:'instruction.available',
      objectType:'assignment',objectId:assignmentId,dedupeKey:`instruction.available:${assignmentId}`});
    released+=1;
  }
  if(released && request.reminderMinutes) await queuePublicationReminders(client,session,publication.id,request);
  const updated=await syncSendCounts(client,row,{now:await nowOf(client)});
  if(updated.state==='published' && updated.undelivered>0)
    await staffAuditOnce(client,{orgId:session.org_id,siteId:session.site_id,action:'instruction.send_incomplete',objectId:row.request_id});
  return {updated,released};
}

export async function instructionAudienceOverview(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const rows=(await client.query(`SELECT language,language_selection_required::int AS required,COUNT(*)::int AS n FROM workers
      WHERE org_id=$1 AND site_id=$2 AND active=true GROUP BY language,language_selection_required`,
    [session.org_id,session.site_id])).rows;
    const byLanguage={en:0,ar:0,ur:0};
    let selected=0,notSelected=0;
    for(const row of rows) {
      if(row.required){notSelected+=row.n;continue;}
      byLanguage[row.language]=(byLanguage[row.language] || 0)+row.n;
      selected+=row.n;
    }
    const crews=(await client.query(`SELECT c.id,c.name,COUNT(w.id)::int AS members FROM crews c
      LEFT JOIN crew_memberships cm ON cm.crew_id=c.id AND cm.org_id=c.org_id AND cm.site_id=c.site_id
      LEFT JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id AND w.active=true
        AND w.language_selection_required=false
      WHERE c.org_id=$1 AND c.site_id=$2 AND c.active=true
      GROUP BY c.id,c.name ORDER BY lower(c.name),c.id LIMIT 5001`,[session.org_id,session.site_id])).rows;
    if(crews.length>5000)throw Error('Instruction crew audience exceeds limit');
    const crewLanguages=(await client.query(`SELECT cm.crew_id,w.language,w.language_selection_required,COUNT(*)::int AS n
      FROM crew_memberships cm JOIN crews c ON c.id=cm.crew_id AND c.org_id=cm.org_id AND c.site_id=cm.site_id AND c.active=true
      JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id AND w.active=true
      WHERE cm.org_id=$1 AND cm.site_id=$2 GROUP BY cm.crew_id,w.language,w.language_selection_required`,[session.org_id,session.site_id])).rows;
    for(const crew of crews){crew.byLanguage={};crew.notSelected=0;}
    const crewById=new Map(crews.map(crew=>[crew.id,crew]));
    for(const row of crewLanguages){const crew=crewById.get(row.crew_id);if(!crew)continue;if(row.language_selection_required)crew.notSelected+=row.n;else crew.byLanguage[row.language]=(crew.byLanguage[row.language]||0)+row.n;}
    return {workers:{total:selected,byLanguage,notSelected},crews,asOf:iso(await nowOf(client))};
  });
}

export async function startInstructionSend(pool,session,input,{schema='public'}={}) {
  const value=instructionInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`understood:instruction:${schema}:${value.requestId}`]);
    const old=(await client.query('SELECT * FROM instruction_sends WHERE request_id=$1 AND org_id=$2 AND site_id=$3',
      [value.requestId,session.org_id,session.site_id])).rows[0];
    if(old) {
      if(!requestMatches(old.request_json,value.request)) throw new Error('Instruction request conflict');
      return sendView(client,old,true);
    }
    await requireWritableEntitlement(client,session.org_id);
    const pendingLanguage=(await client.query(`SELECT 1 FROM workers w WHERE w.org_id=$1 AND w.site_id=$2 AND w.active=true AND w.language_selection_required=true AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM crew_memberships cm WHERE cm.worker_id=w.id AND cm.org_id=w.org_id AND cm.site_id=w.site_id AND cm.crew_id=$3)) LIMIT 1`,[session.org_id,session.site_id,value.audience.type==='crew'?value.audience.crewId:null])).rows.length>0;
    if(pendingLanguage)throw Error('Choose a language for every selected worker in Team before sending.');
    const workers=await audienceWorkers(client,session,value.audience);
    if(!workers.length) throw new Error('Instruction audience is empty');
    if(workers.length>5000) throw new Error('Instruction audience exceeds limit');
    const supported=WORKER_LANGUAGE_CODES.filter(language=>language==='en' || workers.some(worker=>worker.language===language));
    const generation=generationLanguages(supported);
    await createDraftInTransaction(client,session,{requestId:value.requestId,title:value.request.title,source:value.request.source,generationLanguages:generation},schema);
    await queuePreparationInTransaction(client,session,value.requestId,1);
    const audience={type:value.audience.type,workers,...(value.audience.crewId?{crewId:value.audience.crewId}:{})};
    const now=await nowOf(client);
    await client.query(`INSERT INTO instruction_sends
      (request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,response_mode,delivery_mode,state,
       publication_id,audience_count,delivered,undelivered,undelivered_json,error,request_json,requested_by,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'preparing',NULL,$9,0,$9,'[]'::jsonb,NULL,$10,$11,$12,$12)`,
    [value.requestId,session.org_id,session.site_id,value.requestId,randomUUID(),JSON.stringify(audience),
      value.responseMode,value.deliveryMode,workers.length,JSON.stringify(value.request),session.principal_id,now]);
    await insertDeliveries(client,value.requestId,{org_id:session.org_id,site_id:session.site_id},workers,now);
    await domainAudit(client,session,'instruction.send_requested',value.requestId);
    const row=(await client.query('SELECT * FROM instruction_sends WHERE request_id=$1',[value.requestId])).rows[0];
    return sendView(client,row,false);
  });
}

export async function instructionSendStatus(pool,session,requestId,{schema='public'}={}) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT * FROM instruction_sends WHERE request_id=$1 AND org_id=$2 AND site_id=$3',
      [requestId,session.org_id,session.site_id])).rows[0];
    if(!row) throw new Error('Instruction unavailable');
    return sendView(client,row,true);
  });
}

export async function completeInstructionSend(pool,session,requestId,{schema='public',storage,integrationMode='synthetic'}={}) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  const preflight=await instructionAudioPreflight(pool,session,requestId,{schema,storage});
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT * FROM instruction_sends WHERE request_id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',
      [requestId,session.org_id,session.site_id])).rows[0];
    if(!row) throw new Error('Instruction unavailable');
    if(row.state==='published' || row.state==='failed') return sendView(client,row,true);
    await backfillDeliveries(client,row,await nowOf(client));
    const result=await completeSend(client,session,row,preflight,integrationMode);
    return sendView(client,result.updated,false);
  });
}

export async function reconcileInstructionSend(pool,session,requestId,{schema='public'}={}) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const row=(await client.query('SELECT * FROM instruction_sends WHERE request_id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',
      [requestId,session.org_id,session.site_id])).rows[0];
    if(!row) throw new Error('Instruction unavailable');
    if(row.state!=='published') return {send:await sendView(client,row,true),released:0};
    const reconciled=await reconcilePublished(client,session,row);
    return {send:await sendView(client,reconciled.updated,true),released:reconciled.released};
  });
}

export async function retryInstructionSend(pool,session,requestId,input,{schema='public',storage,integrationMode='synthetic'}={}) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  const retry=instructionRetryInput(input);
  const preflight=await instructionAudioPreflight(pool,session,requestId,{schema,storage});
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const retryRow=(await client.query('SELECT * FROM instruction_sends WHERE request_id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',
      [requestId,session.org_id,session.site_id])).rows[0];
    if(!retryRow) throw new Error('Instruction unavailable');
    if(!['published','failed'].includes(retryRow.state)) throw new Error('Instruction retry unavailable');
    let row=retryRow;
    const old=(await client.query('SELECT * FROM instruction_retries WHERE request_id=$1',[retry.requestId])).rows[0];
    if(old) {
      if(old.send_request_id!==requestId || old.org_id!==session.org_id || old.site_id!==session.site_id)
        throw new Error('Instruction retry conflict');
      const saved=old.request_json;
      return {...await sendView(client,row,true),retryRequestId:old.request_id,retried:saved.candidates,
        released:saved.released ?? null,duplicate:true};
    }
    await requireWritableEntitlement(client,session.org_id);
    if(await briefingContentExpired(client,row.briefing_id)) throw new Error('Briefing content expired');
    const request=row.request_json;
    if(request.dueAt && Date.parse(request.dueAt)<=Date.now()) throw new Error('Instruction deadline passed');
    const generation=(await client.query('SELECT count(*)::int AS n FROM instruction_retries WHERE send_request_id=$1',[requestId])).rows[0].n;
    const candidates=(await deliveryRows(client,row.request_id)).filter((delivery)=>['blocked','failed'].includes(delivery.state)
      && delivery.reason!=='content_expired');
    if(!candidates.length) {
      await client.query('INSERT INTO instruction_retries VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [retry.requestId,requestId,session.org_id,session.site_id,session.principal_id,generation,
          JSON.stringify({candidates:0,released:0}),await nowOf(client)]);
      return {...await sendView(client,row,true),retryRequestId:retry.requestId,retried:0,released:0,duplicate:false};
    }
    const eligible=candidates.filter((delivery)=>delivery.attempts<3);
    if(!eligible.length) throw new Error('Instruction retry limit reached');
    let now=await nowOf(client);
    for(const delivery of eligible) {
      await client.query(`UPDATE instruction_deliveries SET state='preparing',reason=NULL,attempts=attempts+1,updated_at=$1
        WHERE request_id=$2 AND worker_id=$3 AND state IN ('blocked','failed')`,[now,row.request_id,delivery.worker_id]);
    }
    if(row.state==='failed') row=await syncSendCounts(client,row,{state:'preparing',publicationId:null,error:null,now});
    const wasFailed=row.state==='preparing' && !row.publication_id;
    const briefing=(await client.query('SELECT * FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',
      [row.briefing_id,session.org_id,session.site_id])).rows[0];
    let updated=row,released=0;
    if(!briefing || briefing.source!==request.source || briefing.title!==request.title) {
      await client.query(`UPDATE instruction_deliveries SET state='failed',reason='source_changed',updated_at=$1
        WHERE request_id=$2 AND state='preparing'`,[now,row.request_id]);
      updated=await syncSendCounts(client,row,{...(wasFailed?{state:'failed',publicationId:null,error:'Instruction source changed.'}:{}),now});
    } else {
      const prepared=briefing.prepared_json;
      const missingContent=eligible.some((delivery)=>!prepared?.languages?.[delivery.language]);
      if(missingContent && ['draft','failed'].includes(briefing.state)) {
        try {await queuePreparationInTransaction(client,session,row.briefing_id,briefing.revision);}
        catch(error) {
          if(!['Draft cannot be processed now','Draft revision changed','Briefing content expired','Briefing is archived'].includes(error.message)) throw error;
        }
      }
      if(row.publication_id) ({updated,released}=await reconcilePublished(client,session,row));
      else ({updated,released}=await completeSend(client,session,row,preflight,integrationMode));
    }
    await client.query('INSERT INTO instruction_retries VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [retry.requestId,requestId,session.org_id,session.site_id,session.principal_id,generation,
        JSON.stringify({candidates:eligible.length,released}),await nowOf(client)]);
    await domainAudit(client,session,'instruction.retry_requested',retry.requestId);
    return {...await sendView(client,updated,false),retryRequestId:retry.requestId,retried:eligible.length,
      released,duplicate:false};
  });
}

export async function processOneInstructionSend(pool,{schema='public',storage,integrationMode='synthetic'}={}) {
  const candidate=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT s.* FROM instruction_sends s JOIN briefings b
      ON b.id=s.briefing_id AND b.org_id=s.org_id AND b.site_id=s.site_id
      WHERE (s.state='preparing' AND b.state IN ('ready','failed'))
        OR (s.state='published' AND b.state IN ('ready','failed')
          AND EXISTS(SELECT 1 FROM instruction_deliveries d WHERE d.request_id=s.request_id AND d.state='preparing'))
      ORDER BY s.created_at,s.request_id LIMIT 1`)).rows[0];
    if(!row)return null;
    const retry=(await client.query('SELECT requested_by FROM instruction_retries WHERE send_request_id=$1 ORDER BY generation DESC LIMIT 1',[row.request_id])).rows[0];
    return {id:row.request_id,actor:await actorSession(client,row,retry?.requested_by ?? row.requested_by)};
  });
  if(!candidate)return false;
  const preflight=candidate.actor?await instructionAudioPreflight(pool,candidate.actor,candidate.id,{schema,storage}):null;
  return domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT s.* FROM instruction_sends s JOIN briefings b
      ON b.id=s.briefing_id AND b.org_id=s.org_id AND b.site_id=s.site_id
      WHERE s.request_id=$1 AND ((s.state='preparing' AND b.state IN ('ready','failed'))
        OR (s.state='published' AND b.state IN ('ready','failed')
          AND EXISTS(SELECT 1 FROM instruction_deliveries d WHERE d.request_id=s.request_id AND d.state='preparing')))
      ORDER BY s.created_at,s.request_id LIMIT 1 FOR UPDATE OF s SKIP LOCKED`,[candidate.id])).rows[0];
    if(!row) return false;
    const retry=(await client.query('SELECT requested_by FROM instruction_retries WHERE send_request_id=$1 ORDER BY generation DESC LIMIT 1',
      [row.request_id])).rows[0];
    const actor=await actorSession(client,row,retry?.requested_by ?? row.requested_by);
    if(!actor) {
      const now=await nowOf(client);
      await client.query(`UPDATE instruction_deliveries SET state='failed',reason='authority_revoked',updated_at=$1
        WHERE request_id=$2 AND state='preparing'`,[now,row.request_id]);
      if(row.state==='preparing') await syncSendCounts(client,row,{state:'failed',publicationId:null,
        error:'Send authority is no longer available.',now});
      else await syncSendCounts(client,row,{now});
      return true;
    }
    await backfillDeliveries(client,row,await nowOf(client));
    if(row.state==='preparing') await completeSend(client,actor,row,preflight,integrationMode);
    else if(row.state==='published') await reconcilePublished(client,actor,row);
    return true;
  });
}

export async function instructionDeliveryContentForAssignment(pool,orgId,siteId,workerId,assignmentId,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT language,content_json FROM instruction_deliveries
      WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3 AND worker_id=$4 AND state='available'`,
    [assignmentId,orgId,siteId,workerId])).rows[0];
    if(!row?.content_json) return null;
    return {language:row.language,content:row.content_json};
  });
}
