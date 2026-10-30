import {randomUUID,createHash} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {briefingAuthority,briefingAudit} from './preparation.mjs';
import {createDraftInTransaction,queuePreparationInTransaction} from './preparation.mjs';
import {ensureInstructionSchema,INSTRUCTION_DELIVERY_MODES,INSTRUCTION_RESPONSE_MODES} from './instruction-schema.mjs';
import {validDeadline} from './briefing-input.mjs';
import {generationLanguages} from './settings-input.mjs';
import {CANONICAL_SOURCE,publishInTransaction} from './domain.mjs';
import {CONTENT_LANGUAGE_CODES} from './languages.mjs';
import {groupedUndelivered,recipientDeliveryReadiness} from './delivery-readiness.mjs';
import {deliveryContent,deliveryContentHash,deliveryStateCounts,instructionRetryInput,unresolvedDeliveries} from './instruction-deliveries.mjs';
import {queuePublicationReminders} from './reminders.mjs';
import {ensureReportAudienceSchema} from './report-scope.mjs';
import {readEntitlement,requireWritableEntitlement} from './entitlements.mjs';
import {entitlementSummary} from './entitlement-model.mjs';
import {recordWorkerEvent,staffAuditOnce} from './notification-events.mjs';

const uuid=(value)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const nonempty=(value,max)=>typeof value==='string' && value.trim().length>0 && value.length<=max;
const present=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const timestamp=()=>Date.parse(NOW());

export function instructionInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || !uuid(input.requestId)
    || typeof input.title!=='string' || input.title.trim().length<3 || input.title.length>120
    || typeof input.source!=='string' || input.source.trim().length<10 || input.source.length>4000
    || Object.keys(input).some((key)=>!['requestId','title','source','audience','responseMode','deliveryMode','dueAt','reminderMinutes'].includes(key)))
    throw new Error('Invalid instruction request');
  const responseMode=input.responseMode ?? 'question',deliveryMode=input.deliveryMode ?? 'both';
  if(!INSTRUCTION_RESPONSE_MODES.includes(responseMode) || !INSTRUCTION_DELIVERY_MODES.includes(deliveryMode))
    throw new Error('Invalid instruction request');
  const raw=input.audience;
  if(!raw || typeof raw!=='object' || Array.isArray(raw) || !['all','crew','members'].includes(raw.type)
    || Object.keys(raw).some((key)=>!['type','crewId','workerIds'].includes(key))
    || (raw.type==='all' && (Object.hasOwn(raw,'crewId')||Object.hasOwn(raw,'workerIds')))
    || (raw.type==='crew' && Object.hasOwn(raw,'workerIds'))
    || (raw.type==='members' && (Object.hasOwn(raw,'crewId') || !Array.isArray(raw.workerIds) || raw.workerIds.length<1 || raw.workerIds.length>5000 || raw.workerIds.some(id=>!nonempty(id,100)) || new Set(raw.workerIds).size!==raw.workerIds.length))
    || (raw.type==='crew' && (!nonempty(raw.crewId,100) || raw.crewId.trim().length===0)))
    throw new Error('Invalid instruction audience');
  const dueAt=input.dueAt ?? null;
  if(dueAt!==null && !validDeadline(dueAt)) throw new Error('Invalid instruction deadline');
  const reminderMinutes=input.reminderMinutes ?? 0;
  if(![0,60,1440].includes(reminderMinutes) || (reminderMinutes && dueAt===null)) throw new Error('Invalid instruction reminder');
  const audience=raw.type==='all' ? {type:'all'} : raw.type==='members'?{type:'members',workerIds:[...raw.workerIds].sort()}:{type:'crew',crewId:raw.crewId.trim()};
  const source=input.source.trim();
  const request={title:input.title.trim(),source,audience,responseMode,deliveryMode,
    sourceHash:createHash('sha256').update(source).digest('hex')};
  if(dueAt!==null) request.dueAt=new Date(dueAt).toISOString();
  if(reminderMinutes) request.reminderMinutes=reminderMinutes;
  return {requestId:input.requestId,audience,responseMode,deliveryMode,
    dueAt:dueAt===null?null:new Date(dueAt).toISOString(),reminderMinutes,sourceHash:request.sourceHash,request};
}

function requestMatches(saved,request) {
  return saved?.title===request.title && saved?.source===request.source
    && saved?.responseMode===request.responseMode && saved?.deliveryMode===request.deliveryMode
    && saved?.audience?.type===request.audience.type
    && (saved?.audience?.crewId ?? null)===(request.audience.crewId ?? null)
    && JSON.stringify(saved?.audience?.workerIds||[])===JSON.stringify(request.audience.workerIds||[])
    && (saved?.dueAt ?? null)===(request.dueAt ?? null)
    && (saved?.reminderMinutes ?? 0)===(request.reminderMinutes ?? 0)
    && (saved?.sourceHash===undefined || saved.sourceHash===request.sourceHash);
}

function audienceWorkers(db,session,audience) {
  if(audience.type==='members'){
    const rows=db.prepare('SELECT id,language FROM workers WHERE org_id=? AND site_id=? AND active=1 AND language_selection_required=0 AND id IN (SELECT value FROM json_each(?)) ORDER BY id').all(session.org_id,session.site_id,JSON.stringify(audience.workerIds));
    if(rows.length!==audience.workerIds.length)throw Error('Selected members are unavailable or need a language');return rows;
  }
  if(audience.type==='crew') {
    const crew=db.prepare('SELECT id,name FROM crews WHERE id=? AND org_id=? AND site_id=? AND active=1')
      .get(audience.crewId,session.org_id,session.site_id);
    if(!crew) throw new Error('Crew unavailable');
    return db.prepare(`SELECT w.id,w.language FROM workers w
      JOIN crew_memberships cm ON cm.worker_id=w.id AND cm.org_id=w.org_id AND cm.site_id=w.site_id
      WHERE w.org_id=? AND w.site_id=? AND w.active=1 AND w.language_selection_required=0 AND cm.crew_id=?
      ORDER BY w.code,w.id`).all(session.org_id,session.site_id,audience.crewId);
  }
  return db.prepare(`SELECT id,language FROM workers
    WHERE org_id=? AND site_id=? AND active=1 AND language_selection_required=0 ORDER BY code,id`)
    .all(session.org_id,session.site_id);
}

function deliveryRows(db,requestId) {
  return db.prepare('SELECT * FROM instruction_deliveries WHERE request_id=? ORDER BY worker_id').all(requestId);
}

function sendView(db,row,duplicate) {
  const audience=JSON.parse(row.audience_json),request=JSON.parse(row.request_json);
  const deliveries=deliveryRows(db,row.request_id);
  const states=deliveries.length ? deliveryStateCounts(deliveries) : null;
  const retryCandidates=deliveries.filter((delivery)=>['blocked','failed'].includes(delivery.state) && delivery.reason!=='content_expired');
  return {requestId:row.request_id,briefingId:row.briefing_id,state:row.state,
    responseMode:row.response_mode,deliveryMode:row.delivery_mode,sourceHash:request.sourceHash ?? null,
    dueAt:request.dueAt ?? null,reminderMinutes:request.reminderMinutes ?? null,
    audience:{type:audience.type,count:row.audience_count,...(audience.crewId?{crewId:audience.crewId}:{})},
    delivered:row.delivered,undelivered:row.undelivered,undeliveredReasons:JSON.parse(row.undelivered_json),
    deliveryStates:states,
    retryable:['published','failed'].includes(row.state) && !!states && retryCandidates.some((delivery)=>delivery.attempts<3)
      && (!request.dueAt || Date.parse(request.dueAt)>Date.now()),
    publicationId:row.publication_id,error:row.error,duplicate};
}

export function instructionAudienceOverview(db,session) {
  briefingAuthority(db,session);
  const rows=db.prepare(`SELECT language,language_selection_required,COUNT(*) AS n FROM workers
    WHERE org_id=? AND site_id=? AND active=1 GROUP BY language,language_selection_required`).all(session.org_id,session.site_id);
  const byLanguage={en:0,ar:0,ur:0};
  let selected=0,notSelected=0;
  for(const row of rows) {
    if(row.language_selection_required){notSelected+=row.n;continue;}
    byLanguage[row.language]=(byLanguage[row.language] || 0)+row.n;
    selected+=row.n;
  }
  const crews=db.prepare(`SELECT c.id,c.name,COUNT(w.id) AS members FROM crews c
    LEFT JOIN crew_memberships cm ON cm.crew_id=c.id AND cm.org_id=c.org_id AND cm.site_id=c.site_id
    LEFT JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id AND w.active=1
      AND w.language_selection_required=0
    WHERE c.org_id=? AND c.site_id=? AND c.active=1
    GROUP BY c.id,c.name ORDER BY lower(c.name),c.id LIMIT 5001`).all(session.org_id,session.site_id);
  if(crews.length>5000)throw Error('Instruction crew audience exceeds limit');
  const crewLanguages=db.prepare(`SELECT cm.crew_id,w.language,w.language_selection_required,COUNT(*) AS n
    FROM crew_memberships cm JOIN crews c ON c.id=cm.crew_id AND c.org_id=cm.org_id AND c.site_id=cm.site_id AND c.active=1
    JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id AND w.active=1
    WHERE cm.org_id=? AND cm.site_id=? GROUP BY cm.crew_id,w.language,w.language_selection_required`).all(session.org_id,session.site_id);
  for(const crew of crews){crew.byLanguage={};crew.notSelected=0;}
  const crewById=new Map(crews.map(crew=>[crew.id,crew]));
  for(const row of crewLanguages){const crew=crewById.get(row.crew_id);if(!crew)continue;if(row.language_selection_required)crew.notSelected+=row.n;else crew.byLanguage[row.language]=(crew.byLanguage[row.language]||0)+row.n;}
  const members=db.prepare('SELECT id,code,name,language,language_selection_required FROM workers WHERE org_id=? AND site_id=? AND active=1 ORDER BY code,id LIMIT 5001').all(session.org_id,session.site_id);
  if(members.length>5000)throw Error('Instruction member audience exceeds limit');
  return {workers:{total:selected,byLanguage,notSelected},crews,members,asOf:NOW()};
}

export function startInstructionSend(db,session,input) {
  const value=instructionInput(input);
  ensureInstructionSchema(db);
  return transaction(db,()=>{
    briefingAuthority(db,session);
    const old=db.prepare('SELECT * FROM instruction_sends WHERE request_id=? AND org_id=? AND site_id=?')
      .get(value.requestId,session.org_id,session.site_id);
    if(old) {
      if(!requestMatches(JSON.parse(old.request_json),value.request)) throw new Error('Instruction request conflict');
      return sendView(db,old,true);
    }
    const composition=db.prepare('SELECT staff_id,org_id,site_id FROM instruction_compositions WHERE id=?').get(value.requestId);
    if(composition&&(composition.staff_id!==session.principal_id||composition.org_id!==session.org_id||composition.site_id!==session.site_id))throw Error('Instruction draft belongs to another supervisor');
    requireWritableEntitlement(db,session.org_id);
    const pendingLanguage=value.audience.type!=='members' && db.prepare(`SELECT 1 FROM workers w WHERE w.org_id=? AND w.site_id=? AND w.active=1 AND w.language_selection_required=1 ${value.audience.type==='crew'?'AND EXISTS(SELECT 1 FROM crew_memberships cm WHERE cm.worker_id=w.id AND cm.org_id=w.org_id AND cm.site_id=w.site_id AND cm.crew_id=?)':''} LIMIT 1`).get(session.org_id,session.site_id,...(value.audience.type==='crew'?[value.audience.crewId]:[]));
    if(pendingLanguage)throw Error('Choose a language for every selected worker in Team before sending.');
    const workers=audienceWorkers(db,session,value.audience);
    if(!workers.length) throw new Error('Instruction audience is empty');
    if(workers.length>5000) throw new Error('Instruction audience exceeds limit');
    const supported=[...new Set(['en',...workers.map((worker)=>worker.language)])]
      .filter((language)=>CONTENT_LANGUAGE_CODES.includes(language));
    const generation=value.request.source.trim()===CANONICAL_SOURCE ? generationLanguages(supported) : ['en'];
    createDraftInTransaction(db,session,{requestId:value.requestId,title:value.request.title,source:value.request.source,generationLanguages:generation});
    queuePreparationInTransaction(db,session,value.requestId,1);
    const now=NOW(),audience={type:value.audience.type,workers,...(value.audience.crewId?{crewId:value.audience.crewId}:{})};
    db.prepare(`INSERT INTO instruction_sends
      (request_id,org_id,site_id,briefing_id,publication_request_id,audience_json,response_mode,delivery_mode,state,
       publication_id,audience_count,delivered,undelivered,undelivered_json,error,request_json,requested_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.requestId,session.org_id,session.site_id,value.requestId,
      randomUUID(),JSON.stringify(audience),value.responseMode,value.deliveryMode,'preparing',null,workers.length,0,workers.length,'[]',null,
      JSON.stringify(value.request),session.principal_id,now,now);
    const insertDelivery=db.prepare(`INSERT INTO instruction_deliveries
      (request_id,org_id,site_id,worker_id,language,state,reason,attempts,assignment_id,content_json,content_hash,updated_at)
      VALUES (?,?,?,?,?,'preparing',NULL,0,NULL,NULL,NULL,?)`);
    for(const worker of workers) insertDelivery.run(value.requestId,session.org_id,session.site_id,worker.id,worker.language,now);
    db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,'instruction.send_requested',value.requestId,now);
    const row=db.prepare('SELECT * FROM instruction_sends WHERE request_id=?').get(value.requestId);
    return sendView(db,row,false);
  });
}

export function instructionSendStatus(db,session,requestId) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  ensureInstructionSchema(db);
  briefingAuthority(db,session);
  const row=db.prepare('SELECT * FROM instruction_sends WHERE request_id=? AND org_id=? AND site_id=?')
    .get(requestId,session.org_id,session.site_id);
  if(!row) throw new Error('Instruction unavailable');
  return sendView(db,row,true);
}

function backfillDeliveries(db,row,now) {
  if(deliveryRows(db,row.request_id).length) return;
  const audience=JSON.parse(row.audience_json);
  const insert=db.prepare(`INSERT OR IGNORE INTO instruction_deliveries
    (request_id,org_id,site_id,worker_id,language,state,reason,attempts,assignment_id,content_json,content_hash,updated_at)
    VALUES (?,?,?,?,?,'preparing',NULL,0,NULL,NULL,NULL,?)`);
  for(const worker of audience.workers) insert.run(row.request_id,row.org_id,row.site_id,worker.id,worker.language,now);
}

function actorSession(db,row,principalId=row.requested_by) {
  const staff=db.prepare('SELECT role,active FROM staff WHERE id=? AND org_id=? AND site_id=?')
    .get(principalId,row.org_id,row.site_id);
  if(!staff || !staff.active || !['owner','supervisor'].includes(staff.role)) return null;
  return {principal_type:'staff',principal_id:principalId,org_id:row.org_id,site_id:row.site_id,role:staff.role};
}

function workerDeletionPending(db,orgId,workerId) {
  return present(db,'worker_deletion_requests')
    && !!db.prepare('SELECT 1 FROM worker_deletion_requests WHERE worker_id=? AND org_id=?').get(workerId,orgId);
}

function settle(db,requestId,workerId,state,reason,now) {
  db.prepare(`UPDATE instruction_deliveries SET state=?,reason=?,updated_at=?
    WHERE request_id=? AND worker_id=? AND state='preparing'`).run(state,reason,now,requestId,workerId);
}

function groupedFromDeliveries(deliveries) {
  return groupedUndelivered(deliveries.filter((delivery)=>delivery.state!=='available' && delivery.reason)
    .map((delivery)=>({reason:delivery.reason,language:delivery.language})));
}

function syncSendCounts(db,row,{error=null,state=row.state,publicationId=row.publication_id,now=NOW()}={}) {
  const deliveries=deliveryRows(db,row.request_id);
  const available=deliveries.filter((delivery)=>delivery.state==='available').length;
  const undelivered=deliveries.length-available,grouped=groupedFromDeliveries(deliveries);
  db.prepare(`UPDATE instruction_sends SET state=?,publication_id=?,delivered=?,undelivered=?,undelivered_json=?,error=?,updated_at=?
    WHERE request_id=? AND org_id=? AND site_id=?`)
    .run(state,publicationId,available,undelivered,JSON.stringify(grouped),error,now,row.request_id,row.org_id,row.site_id);
  return db.prepare('SELECT * FROM instruction_sends WHERE request_id=?').get(row.request_id);
}

function settleReadOnly(db,row,{published,now}) {
  const summary=entitlementSummary(readEntitlement(db,row.org_id),{now:Date.parse(now)});
  if(summary.writeAllowed) return null;
  db.prepare(`UPDATE instruction_deliveries SET state='blocked',reason='workspace_read_only',updated_at=?
    WHERE request_id=? AND state='preparing'`).run(now,row.request_id);
  return syncSendCounts(db,row,{state:published?'published':'failed',publicationId:published?row.publication_id:null,
    error:'Workspace is read-only. Delivery is waiting for activation.',now});
}

function failPreparingSend(db,row,error,reason,now) {
  db.prepare(`UPDATE instruction_deliveries SET state='failed',reason=?,updated_at=?
    WHERE request_id=? AND state='preparing'`).run(reason,now,row.request_id);
  return syncSendCounts(db,row,{state:'failed',publicationId:null,error,now});
}

function completeSend(db,row,session) {
  const briefing=db.prepare('SELECT * FROM briefings WHERE id=? AND org_id=? AND site_id=?')
    .get(row.briefing_id,session.org_id,session.site_id);
  if(!briefing) throw new Error('Instruction unavailable');
  const now=NOW();
  const readOnly=settleReadOnly(db,row,{published:false,now});
  if(readOnly) return {updated:readOnly,released:0};
  if(briefing.state==='failed') {
    const job=db.prepare("SELECT error FROM jobs WHERE briefing_id=? AND org_id=? AND site_id=? AND kind='prepare' ORDER BY created_at DESC LIMIT 1")
      .get(briefing.id,session.org_id,session.site_id);
    const updated=failPreparingSend(db,row,String(job?.error || 'Instruction preparation failed').slice(0,300),'preparation_failed',now);
    return {updated,released:0};
  }
  if(briefing.state!=='ready') return {updated:row,released:0};
  let prepared;
  try{prepared=JSON.parse(briefing.prepared_json);}catch{throw new Error('Instruction preparation unavailable');}
  const request=JSON.parse(row.request_json);
  if(request.dueAt && Date.parse(request.dueAt)<=timestamp()) {
    db.prepare(`UPDATE instruction_deliveries SET state='blocked',reason='deadline_passed',updated_at=?
      WHERE request_id=? AND state='preparing'`).run(now,row.request_id);
    const updated=syncSendCounts(db,row,{state:'failed',publicationId:null,error:'Instruction deadline passed before delivery.',now});
    return {updated,released:0};
  }
  const deliveries=deliveryRows(db,row.request_id);
  const deliverable=[];
  for(const delivery of deliveries) {
    if(delivery.state!=='preparing') continue;
    const worker=db.prepare('SELECT id,language,active,language_selection_required FROM workers WHERE id=? AND org_id=? AND site_id=?')
      .get(delivery.worker_id,session.org_id,session.site_id);
    if(!worker || !worker.active) {settle(db,row.request_id,delivery.worker_id,'blocked','worker_inactive',now);continue;}
    if(workerDeletionPending(db,session.org_id,delivery.worker_id)) {settle(db,row.request_id,delivery.worker_id,'blocked','worker_deletion',now);continue;}
    if(worker.language_selection_required) {settle(db,row.request_id,delivery.worker_id,'blocked','language_not_selected',now);continue;}
    if(worker.language!==delivery.language) {settle(db,row.request_id,delivery.worker_id,'blocked','language_changed',now);continue;}
    const readiness=recipientDeliveryReadiness(prepared,{...worker,language:delivery.language},
      {responseMode:row.response_mode,deliveryMode:row.delivery_mode});
    if(!readiness.delivery) {settle(db,row.request_id,delivery.worker_id,'failed',readiness.reason,now);continue;}
    deliverable.push(worker);
  }
  if(!deliverable.length) {
    const updated=syncSendCounts(db,row,{state:'failed',publicationId:null,
      error:'No recipient has prepared content in their language yet.',now});
    return {updated,released:0};
  }
  const published=publishInTransaction(db,session,row.briefing_id,{requestId:row.publication_request_id,revision:briefing.revision,
    nextVersion:briefing.next_version,workerIds:deliverable.map((worker)=>worker.id),
    ...(request.dueAt?{dueAt:request.dueAt}:{}),...(request.reminderMinutes?{reminderMinutes:request.reminderMinutes}:{})});
  const assignments=db.prepare('SELECT id,worker_id FROM assignments WHERE publication_id=? AND org_id=? AND site_id=?')
    .all(published.id,session.org_id,session.site_id);
  const assignmentByWorker=new Map(assignments.map((assignment)=>[assignment.worker_id,assignment.id]));
  for(const worker of deliverable) {
    const assignmentId=assignmentByWorker.get(worker.id);
    if(!assignmentId) throw new Error('Instruction delivery unavailable');
    const content=prepared.languages[worker.language];
    db.prepare(`UPDATE instruction_deliveries SET state='available',reason=NULL,assignment_id=?,content_hash=?,updated_at=?
      WHERE request_id=? AND worker_id=? AND state='preparing'`).run(assignmentId,
      deliveryContentHash(worker.language,content,{responseMode:row.response_mode,deliveryMode:row.delivery_mode}),
      NOW(),row.request_id,worker.id);
  }
  const updated=syncSendCounts(db,row,{state:'published',publicationId:published.id,now:NOW()});
  briefingAudit(db,session,'instruction.send_published',row.request_id);
  if(updated.undelivered>0) staffAuditOnce(db,{orgId:session.org_id,siteId:session.site_id,action:'instruction.send_incomplete',objectId:row.request_id});
  return {updated,released:deliverable.length};
}

export function completeInstructionSend(db,session,requestId) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  ensureInstructionSchema(db);
  briefingAuthority(db,session);
  return transaction(db,()=>{
    const row=db.prepare('SELECT * FROM instruction_sends WHERE request_id=? AND org_id=? AND site_id=?')
      .get(requestId,session.org_id,session.site_id);
    if(!row) throw new Error('Instruction unavailable');
    if(row.state==='published' || row.state==='failed') return sendView(db,row,true);
    backfillDeliveries(db,row,NOW());
    return sendView(db,completeSend(db,row,session).updated,false);
  });
}

function reconcilePublished(db,row,session) {
  const publication=db.prepare('SELECT id,state,snapshot_json,published_at FROM publications WHERE id=? AND org_id=? AND site_id=? AND briefing_id=?')
    .get(row.publication_id,session.org_id,session.site_id,row.briefing_id);
  const now=NOW();
  if(!publication || publication.state!=='published') {
    db.prepare(`UPDATE instruction_deliveries SET state='failed',reason='publication_unavailable',updated_at=?
      WHERE request_id=? AND state='preparing'`).run(now,row.request_id);
    const updated=syncSendCounts(db,row,{now});
    return {updated,released:0};
  }
  const readOnly=settleReadOnly(db,row,{published:true,now});
  if(readOnly) return {updated:readOnly,released:0};
  const request=JSON.parse(row.request_json),snapshot=JSON.parse(publication.snapshot_json);
  const briefing=db.prepare('SELECT * FROM briefings WHERE id=? AND org_id=? AND site_id=?')
    .get(row.briefing_id,session.org_id,session.site_id);
  if(briefing?.state==='failed') {
    db.prepare(`UPDATE instruction_deliveries SET state='failed',reason='preparation_failed',updated_at=?
      WHERE request_id=? AND state='preparing'`).run(now,row.request_id);
    return {updated:syncSendCounts(db,row,{now}),released:0};
  }
  let prepared=null;
  if(briefing?.state!=='failed' && briefing?.prepared_json) {
    try{prepared=JSON.parse(briefing.prepared_json);}catch{prepared=null;}
    if(prepared?.source!==request.source) prepared=null;
  }
  const proceeding=briefing?.state==='processing' || briefing?.state==='draft';
  let released=0;
  for(const delivery of deliveryRows(db,row.request_id)) {
    if(delivery.state!=='preparing') continue;
    const worker=db.prepare('SELECT id,language,active,language_selection_required FROM workers WHERE id=? AND org_id=? AND site_id=?')
      .get(delivery.worker_id,session.org_id,session.site_id);
    if(!worker || !worker.active) {settle(db,row.request_id,delivery.worker_id,'blocked','worker_inactive',now);continue;}
    if(workerDeletionPending(db,session.org_id,delivery.worker_id)) {settle(db,row.request_id,delivery.worker_id,'blocked','worker_deletion',now);continue;}
    if(worker.language_selection_required) {settle(db,row.request_id,delivery.worker_id,'blocked','language_not_selected',now);continue;}
    if(worker.language!==delivery.language) {settle(db,row.request_id,delivery.worker_id,'blocked','language_changed',now);continue;}
    if(request.dueAt && Date.parse(request.dueAt)<=timestamp()) {settle(db,row.request_id,delivery.worker_id,'blocked','deadline_passed',now);continue;}
    const snapshotContent=snapshot.languages?.[delivery.language];
    const lateContent=prepared?.languages?.[delivery.language];
    const content=snapshotContent || lateContent;
    const readiness=recipientDeliveryReadiness(snapshotContent ? snapshot : prepared,{...worker,language:delivery.language},
      {responseMode:row.response_mode,deliveryMode:row.delivery_mode});
    if(!readiness.delivery) {
      if(!proceeding) settle(db,row.request_id,delivery.worker_id,'failed',readiness.reason,now);
      continue;
    }
    if(!content) continue;
    ensureReportAudienceSchema(db);
    const id=randomUUID();
    db.prepare(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language)
      VALUES (?,?,?,?,?,?,?,?)`).run(id,session.org_id,session.site_id,publication.id,worker.id,
      request.dueAt ?? null,NOW(),delivery.language);
    db.prepare(`INSERT OR IGNORE INTO publication_report_audience(assignment_id,org_id,site_id,publication_id,crew_id,crew_name)
      SELECT a.id,a.org_id,a.site_id,a.publication_id,c.id,c.name FROM assignments a
      LEFT JOIN crew_memberships m ON m.worker_id=a.worker_id AND m.org_id=a.org_id AND m.site_id=a.site_id
      LEFT JOIN crews c ON c.id=m.crew_id AND c.org_id=a.org_id AND c.site_id=a.site_id WHERE a.id=?`).run(id);
    const late=!snapshotContent && !!lateContent;
    db.prepare(`UPDATE instruction_deliveries SET state='available',reason=NULL,assignment_id=?,content_json=?,content_hash=?,updated_at=?
      WHERE request_id=? AND worker_id=? AND state='preparing'`).run(id,
      late?JSON.stringify(deliveryContent(lateContent)):null,
      deliveryContentHash(delivery.language,content,{responseMode:row.response_mode,deliveryMode:row.delivery_mode}),
      NOW(),row.request_id,worker.id);
    recordWorkerEvent(db,{orgId:session.org_id,siteId:session.site_id,workerId:worker.id,kind:'instruction.available',
      objectType:'assignment',objectId:id,dedupeKey:`instruction.available:${id}`,now});
    released+=1;
  }
  if(released && request.reminderMinutes && present(db,'assignment_reminders')) {
    try{queuePublicationReminders(db,session,publication.id,request);}catch{/* Reminder is auxiliary; delivery evidence remains primary. */}
  }
  const updated=syncSendCounts(db,row,{now});
  if(updated.state==='published' && updated.undelivered>0)
    staffAuditOnce(db,{orgId:session.org_id,siteId:session.site_id,action:'instruction.send_incomplete',objectId:row.request_id});
  return {updated,released};
}

export function instructionDeliveryContentForAssignment(db,orgId,siteId,workerId,assignmentId) {
  if(!present(db,'instruction_deliveries')) return null;
  const row=db.prepare(`SELECT language,content_json FROM instruction_deliveries
    WHERE assignment_id=? AND org_id=? AND site_id=? AND worker_id=? AND state='available'`)
    .get(assignmentId,orgId,siteId,workerId);
  if(!row?.content_json) return null;
  try{const content=JSON.parse(row.content_json);return content && typeof content==='object' ? {language:row.language,content} : null;}
  catch{return null;}
}

export function reconcileInstructionSend(db,session,requestId) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  ensureInstructionSchema(db);
  briefingAuthority(db,session);
  return transaction(db,()=>{
    const row=db.prepare('SELECT * FROM instruction_sends WHERE request_id=? AND org_id=? AND site_id=?')
      .get(requestId,session.org_id,session.site_id);
    if(!row) throw new Error('Instruction unavailable');
    if(row.state!=='published') return {send:sendView(db,row,true),released:0};
    const reconciled=reconcilePublished(db,row,session);
    return {send:sendView(db,reconciled.updated,true),released:reconciled.released};
  });
}

export function retryInstructionSend(db,session,requestId,input) {
  if(!uuid(requestId)) throw new Error('Invalid instruction request');
  const retry=instructionRetryInput(input);
  ensureInstructionSchema(db);
  return transaction(db,()=>{
    briefingAuthority(db,session);
    const retryRow=db.prepare('SELECT * FROM instruction_sends WHERE request_id=? AND org_id=? AND site_id=?')
      .get(requestId,session.org_id,session.site_id);
    if(!retryRow) throw new Error('Instruction unavailable');
    if(!['published','failed'].includes(retryRow.state)) throw new Error('Instruction retry unavailable');
    let row=retryRow;
    const old=db.prepare('SELECT * FROM instruction_retries WHERE request_id=?').get(retry.requestId);
    if(old) {
      if(old.send_request_id!==requestId || old.org_id!==session.org_id || old.site_id!==session.site_id)
        throw new Error('Instruction retry conflict');
      const saved=JSON.parse(old.request_json);
      return {...sendView(db,row,true),retryRequestId:old.request_id,retried:saved.candidates,
        released:saved.released ?? null,duplicate:true};
    }
    requireWritableEntitlement(db,session.org_id);
    const request=JSON.parse(row.request_json);
    if(request.dueAt && Date.parse(request.dueAt)<=Date.now()) throw new Error('Instruction deadline passed');
    const generation=db.prepare('SELECT count(*) AS n FROM instruction_retries WHERE send_request_id=?').get(requestId).n;
    const candidates=deliveryRows(db,row.request_id).filter((delivery)=>['blocked','failed'].includes(delivery.state)
      && delivery.reason!=='content_expired');
    if(!candidates.length) {
      db.prepare('INSERT INTO instruction_retries VALUES(?,?,?,?,?,?,?,?)').run(retry.requestId,requestId,session.org_id,session.site_id,
        session.principal_id,generation,JSON.stringify({candidates:0,released:0}),NOW());
      return {...sendView(db,row,true),retryRequestId:retry.requestId,retried:0,released:0,duplicate:false};
    }
    const eligible=candidates.filter((delivery)=>delivery.attempts<3);
    if(!eligible.length) throw new Error('Instruction retry limit reached');
    let now=NOW();
    for(const delivery of eligible) {
      db.prepare(`UPDATE instruction_deliveries SET state='preparing',reason=NULL,attempts=attempts+1,updated_at=?
        WHERE request_id=? AND worker_id=? AND state IN ('blocked','failed')`).run(now,row.request_id,delivery.worker_id);
    }
    if(row.state==='failed') row=syncSendCounts(db,row,{state:'preparing',publicationId:null,error:null,now});
    const wasFailed=row.state==='preparing' && !row.publication_id;
    const briefing=db.prepare('SELECT * FROM briefings WHERE id=? AND org_id=? AND site_id=?')
      .get(row.briefing_id,session.org_id,session.site_id);
    let updated=row,released=0;
    if(!briefing || briefing.source!==request.source || briefing.title!==request.title) {
      db.prepare(`UPDATE instruction_deliveries SET state='failed',reason='source_changed',updated_at=?
        WHERE request_id=? AND state='preparing'`).run(now,row.request_id);
      updated=syncSendCounts(db,row,{...(wasFailed?{state:'failed',publicationId:null,error:'Instruction source changed.'}:{}),now});
    } else {
      let prepared=null;
      if(briefing.prepared_json) {
        try{prepared=JSON.parse(briefing.prepared_json);}catch{prepared=null;}
      }
      const missingContent=eligible.some((delivery)=>!prepared?.languages?.[delivery.language]);
      if(missingContent && ['draft','failed'].includes(briefing.state)) {
        try{queuePreparationInTransaction(db,session,row.briefing_id,briefing.revision);}
        catch(error){if(!['Draft cannot be processed now','Draft revision changed'].includes(error.message))throw error;}
      }
      if(row.publication_id) ({updated,released}=reconcilePublished(db,row,session));
      else ({updated,released}=completeSend(db,row,session));
    }
    db.prepare('INSERT INTO instruction_retries VALUES(?,?,?,?,?,?,?,?)').run(retry.requestId,requestId,session.org_id,session.site_id,
      session.principal_id,generation,JSON.stringify({candidates:eligible.length,released}),NOW());
    briefingAudit(db,session,'instruction.retry_requested',retry.requestId);
    return {...sendView(db,updated,false),retryRequestId:retry.requestId,retried:eligible.length,
      released,duplicate:false};
  });
}

export function processOneInstructionSend(db) {
  ensureInstructionSchema(db);
  const row=db.prepare(`SELECT s.* FROM instruction_sends s JOIN briefings b
    ON b.id=s.briefing_id AND b.org_id=s.org_id AND b.site_id=s.site_id
    WHERE (s.state='preparing' AND b.state IN ('ready','failed'))
      OR (s.state='published' AND b.state IN ('ready','failed')
        AND EXISTS(SELECT 1 FROM instruction_deliveries d WHERE d.request_id=s.request_id AND d.state='preparing'))
    ORDER BY s.created_at,s.request_id LIMIT 1`).get();
  if(!row) return false;
  const retry=db.prepare("SELECT requested_by FROM instruction_retries WHERE send_request_id=? ORDER BY generation DESC LIMIT 1")
    .get(row.request_id);
  const actor=actorSession(db,row,retry?.requested_by ?? row.requested_by);
  if(!actor) {
    transaction(db,()=>{
      const now=NOW();
      db.prepare(`UPDATE instruction_deliveries SET state='failed',reason='authority_revoked',updated_at=?
        WHERE request_id=? AND state='preparing'`).run(now,row.request_id);
      const current=db.prepare('SELECT * FROM instruction_sends WHERE request_id=?').get(row.request_id);
      if(current.state==='preparing') syncSendCounts(db,current,{state:'failed',publicationId:null,
        error:'Send authority is no longer available.',now});
      else syncSendCounts(db,current,{now});
    });
    return true;
  }
  transaction(db,()=>{
    const current=db.prepare('SELECT * FROM instruction_sends WHERE request_id=? AND org_id=? AND site_id=?')
      .get(row.request_id,row.org_id,row.site_id);
    if(!current) return;
    if(current.state==='preparing') {backfillDeliveries(db,current,NOW());completeSend(db,current,actor);}
    else if(current.state==='published') reconcilePublished(db,current,actor);
  });
  return true;
}
