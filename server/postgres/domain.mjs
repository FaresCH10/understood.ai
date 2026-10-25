import { randomUUID } from 'node:crypto';
import { withTransaction } from './db.mjs';
import { schemaName } from './migrate.mjs';
import { publicationInput,readySnapshot,withdrawalInput } from '../briefing-input.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {assertGlossaryCurrent} from '../glossary-input.mjs';
import {generatedBundleEvidence,verifyGeneratedAudio} from './generated-audio.mjs';
import {bundleHash,reviewContent} from '../ai/prepared-bundle.mjs';
import {createHash} from 'node:crypto';
export { readySnapshot } from '../briefing-input.mjs';
import {scheduleHash} from '../schedule-input.mjs';
import {queuePublicationReminders} from './reminders.mjs';
import {requireTenantActive} from './operations-gates.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {acceptingRepeat,consumeRepeat} from './case-repeats.mjs';
import {checkedPresentationBinding,recordPresentationBinding} from './presentations.mjs';
import {instructionModes} from './instruction-schema.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {recordWorkerEvent,recordStaffPushEvent} from './notification-events.mjs';

const id = (value) => typeof value==='string' && value.length>0 && value.length<=100;
const nonempty = (value,max) => typeof value==='string' && value.trim().length>0 && value.length<=max;

export function domainTransaction(pool,schema,fn) {
  schemaName(schema);
  return withTransaction(pool,async (client) => {
    await client.query(`SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true),
      set_config('lock_timeout','5s',true),set_config('statement_timeout','10s',true)`,[schema]);
    return fn(client);
  });
}

export async function domainAudit(client,session,action,objectId) {
  const auditId=randomUUID();
  await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,[auditId,session.org_id,session.site_id,session.principal_type,session.principal_id,action,objectId]);
  if(!(action==='clarification.message' && session.principal_type==='staff'))
    await recordStaffPushEvent(client,{orgId:session.org_id,siteId:session.site_id,auditId,action,objectId});
}

export async function requirePrincipal(client,session,type,staffRoles=['owner','supervisor']) {
  if (!['staff','worker'].includes(type) || session?.principal_type!==type || (type==='staff' && !staffRoles.includes(session.role))) throw new Error('Forbidden');
  await requireTenantActive(client,session.org_id);
  if(type==='worker')await requireWorkerSiteAccess(client,session.org_id,session.site_id);
  const table = type==='staff' ? 'staff' : 'workers';
  const row = (await client.query(`SELECT id FROM ${table} WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true
    ${type==='staff' ? 'AND role=$4' : ''} FOR SHARE`,[session.principal_id,session.org_id,session.site_id,...(type==='staff' ? [session.role] : [])])).rows[0];
  if (!row) throw new Error('Forbidden');
  if (type==='worker' && session.access_mode==='credential') {
    if (session.grant_id) {
      const grant = (await client.query(`SELECT id FROM worker_grants WHERE id=$1 AND org_id=$2 AND site_id=$3 AND worker_id=$4
        AND redeemed_at IS NOT NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
      [session.grant_id,session.org_id,session.site_id,session.principal_id])).rows[0];
      if (!grant) throw new Error('Sign in required');
    } else {
      const revision=session.credential_revision;
      if(!Number.isSafeInteger(revision) || revision<1) throw new Error('Sign in required');
      const credential=(await client.query(`SELECT worker_id FROM worker_credentials WHERE worker_id=$1 AND org_id=$2
        AND site_id=$3 AND state='active' AND credential_revision=$4 FOR SHARE`,
      [session.principal_id,session.org_id,session.site_id,revision])).rows[0];
      if (!credential) throw new Error('Sign in required');
    }
  }
  if(session.token_hash!==undefined) {
    const current=(await client.query(`SELECT token_hash FROM sessions WHERE token_hash=$1 AND org_id=$2 AND site_id=$3
      AND principal_type=$4 AND principal_id=$5 AND access_mode='credential' AND grant_id IS NOT DISTINCT FROM $6
      AND credential_revision IS NOT DISTINCT FROM $7
      AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
    [session.token_hash,session.org_id,session.site_id,type,session.principal_id,session.grant_id ?? null,session.credential_revision ?? null])).rows[0];
    if(!current) throw Error('Sign in required');
  }
}

export async function requireActiveBriefing(client,session,id) {
  if((await client.query('SELECT 1 FROM briefing_content_purges WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id])).rows.length)throw Error('Briefing content expired');
  if((await client.query('SELECT 1 FROM briefing_archives WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id])).rows.length) throw new Error('Briefing is archived');
}

async function publicationReplay(client,session,briefingId,input,request) {
  const old=(await client.query(`SELECT r.request_json,p.id,p.version,(SELECT COUNT(*)::int FROM assignments a WHERE a.publication_id=p.id) AS assigned
    FROM publication_requests r JOIN publications p ON p.id=r.publication_id AND p.org_id=r.org_id AND p.site_id=r.site_id
    WHERE r.request_id=$1 AND r.briefing_id=$2 AND r.org_id=$3 AND r.site_id=$4`,[input.requestId,briefingId,session.org_id,session.site_id])).rows[0];
  if(!old) return null;
  if(JSON.stringify({revision:old.request_json.revision,workerIds:old.request_json.workerIds,dueAt:old.request_json.dueAt,...(old.request_json.reminderMinutes?{reminderMinutes:old.request_json.reminderMinutes}:{}),...(old.request_json.nextVersion!==undefined?{nextVersion:old.request_json.nextVersion}:{})})!==JSON.stringify(request)) throw Error('Publication request conflict');
  return {id:old.id,version:old.version,assigned:old.assigned,duplicate:true};
}

export async function publicationPreflight(pool,session,briefingId,input,request,{schema='public',integrationMode,storage}={}) {
  const preflight=await domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const replay=await publicationReplay(client,session,briefingId,input,request);if(replay) return {replay};
    if(!Number.isSafeInteger(request.nextVersion))throw Error('Invalid publication version');
    const row=(await client.query('SELECT prepared_json FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',[briefingId,session.org_id,session.site_id])).rows[0];
    if(!row?.prepared_json?.artifactBundle) return null;
    if(integrationMode!=='synthetic') throw Error('Live publication artifact verification is unavailable');
    return {evidence:await generatedBundleEvidence(client,{...session,briefing_id:briefingId},row.prepared_json),snapshotHash:bundleHash(row.prepared_json)};
  });
  if(preflight?.replay) return preflight;
  if(preflight) await verifyGeneratedAudio(preflight.evidence,storage);
  return preflight;
}

export async function checkedPublication(client,session,briefing,request,{integrationMode,preflight,modes}={}) {
  const briefingId=briefing.id;
  await requireActiveBriefing(client,session,briefingId);
  if (briefing.revision!==request.revision) throw new Error('Draft revision changed');
  if (!Number.isSafeInteger(request.nextVersion)) throw new Error('Invalid publication version');
  if (briefing.next_version!==request.nextVersion) throw new Error('Draft version changed');
  if (request.dueAt!==null && !(await client.query('SELECT $1::timestamptz>clock_timestamp() AS valid',[request.dueAt])).rows[0].valid) throw new Error('Deadline must be in the future');
  const workers = (await client.query(`SELECT id,language,language_selection_required::int AS language_selection_required
    FROM workers WHERE org_id=$1 AND site_id=$2 AND id=ANY($3::text[])
    AND active=true ORDER BY id FOR SHARE`,[session.org_id,session.site_id,request.workerIds])).rows;
  if (workers.length!==request.workerIds.length) throw new Error('Recipient unavailable');
  if (workers.some(worker=>worker.language_selection_required)) throw new Error('Recipient language not selected');
  const publicationModes=modes ?? await instructionModes(client,session.org_id,session.site_id,briefingId);
  let snapshot;
  const glossary=await readGlossarySnapshot(client,session.org_id,session.site_id);
  if(briefing.prepared_json?.artifactBundle) {
    if(integrationMode!=='synthetic' || !preflight || preflight.snapshotHash!==bundleHash(briefing.prepared_json)
      || briefing.state!=='ready') throw Error('Briefing is not technically ready');
    const {manifest}=await generatedBundleEvidence(client,{...session,briefing_id:briefingId},briefing.prepared_json);
    const review=(await client.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[briefingId,session.org_id,session.site_id])).rows[0]?.content_json ?? null;
    const reviewHash=createHash('sha256').update(JSON.stringify(reviewContent(review,briefing.revision))).digest('hex');
    if(manifest.source!==briefing.source || manifest.dependencies.revision!==briefing.revision || manifest.dependencies.reviewHash!==reviewHash) throw Error('Draft revision changed');
    if(manifest.dependencies.glossaryHash!==glossary.hash || manifest.dependencies.glossaryRevision!==glossary.revision) throw Error('Glossary dependency changed');
    if(workers.some(worker=>{
      const language=manifest.languages[worker.language];
      return !language || (publicationModes.responseMode==='question' && !nonempty(language.question,500))
        || (publicationModes.deliveryMode!=='text' && (!language.speech?.body || !language.speech?.question));
    })) throw Error('Recipient language is unavailable');
    snapshot=briefing.prepared_json;
  }else {
    snapshot=readySnapshot(briefing,workers,integrationMode,publicationModes);
    assertGlossaryCurrent(snapshot,glossary);
  }
  return {snapshot,workers};
}

export async function publishInTransaction(client,session,briefingId,input,{integrationMode,preflight,scheduleId,verifySchedule,modes,request=publicationInput(input)}={}) {
  await requirePrincipal(client,session,'staff');
  const briefing = (await client.query(`SELECT * FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE`,
    [briefingId,session.org_id,session.site_id])).rows[0];
  if (!briefing) throw new Error('Briefing unavailable');
  if(!scheduleId && (await client.query('SELECT 1 FROM publication_schedules WHERE id=$1',[input.requestId])).rows.length)throw Error('Publication request conflict');
  let scheduled;
  if(scheduleId) {
    scheduled=(await client.query(`SELECT * FROM publication_schedules WHERE id=$1 AND briefing_id=$2 AND org_id=$3 AND site_id=$4
      AND state='queued' AND publish_at<=clock_timestamp() AND (retry_at IS NULL OR retry_at<=clock_timestamp()) FOR UPDATE`,[scheduleId,briefingId,session.org_id,session.site_id])).rows[0];
    if(!scheduled)return null;
    await verifySchedule(client,scheduled,briefing);
  }
  const old=await publicationReplay(client,session,briefingId,input,request);if(old) return old;
  await requireWritableEntitlement(client,session.org_id);
  const {workers,snapshot}=await checkedPublication(client,session,briefing,request,{integrationMode,preflight,modes});
  if(scheduled && (scheduled.snapshot_hash!==scheduleHash(snapshot) || scheduleHash(scheduled.recipients_json)!==scheduleHash(workers)))throw Error('Scheduled recipient language changed');
  const publicationId = randomUUID();
  await client.query(`UPDATE publications SET state='superseded' WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 AND state='published'`,[briefing.id,session.org_id,session.site_id]);
  await client.query(`INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,state)
    VALUES ($1,$2,$3,$4,$5,$6,'published')`,[publicationId,session.org_id,session.site_id,briefing.id,briefing.next_version,JSON.stringify(snapshot)]);
  const assignmentIds=workers.map(()=>randomUUID());
  await client.query(`INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,language)
    SELECT unnest($1::text[]),$2,$3,$4,unnest($5::text[]),$6::timestamptz,unnest($7::text[])`,
  [assignmentIds,session.org_id,session.site_id,publicationId,workers.map((worker) => worker.id),request.dueAt,workers.map((worker) => worker.language)]);
  for(let i=0;i<workers.length;i++) await recordWorkerEvent(client,{orgId:session.org_id,siteId:session.site_id,workerId:workers[i].id,
    kind:'instruction.available',objectType:'assignment',objectId:assignmentIds[i],dedupeKey:`instruction.available:${assignmentIds[i]}`});
  await client.query(`INSERT INTO publication_report_audience(assignment_id,org_id,site_id,publication_id,crew_id,crew_name)
    SELECT a.id,a.org_id,a.site_id,a.publication_id,c.id,c.name FROM assignments a
    LEFT JOIN crew_memberships m ON m.worker_id=a.worker_id AND m.org_id=a.org_id AND m.site_id=a.site_id
    LEFT JOIN crews c ON c.id=m.crew_id AND c.org_id=a.org_id AND c.site_id=a.site_id WHERE a.publication_id=$1`,[publicationId]);
  await queuePublicationReminders(client,session,publicationId,request);
  await client.query(`INSERT INTO publication_requests(request_id,org_id,site_id,briefing_id,publication_id,request_json)
    VALUES ($1,$2,$3,$4,$5,$6)`,[input.requestId,session.org_id,session.site_id,briefing.id,publicationId,JSON.stringify(request)]);
  await client.query(`UPDATE briefings SET next_version=next_version+1,state='draft',updated_at=clock_timestamp() WHERE id=$1 AND org_id=$2 AND site_id=$3`,[briefing.id,session.org_id,session.site_id]);
  await domainAudit(client,session,'briefing.published',publicationId);
  if(scheduled)await client.query("UPDATE publication_schedules SET state='published',publication_id=$1,finished_at=clock_timestamp(),attempts=attempts+1,retry_at=NULL WHERE id=$2 AND state='queued'",[publicationId,scheduled.id]);
  return {id:publicationId,version:briefing.next_version,assigned:workers.length,duplicate:false};
}

export async function publish(pool,session,briefingId,input,{schema='public',integrationMode,storage,scheduleId,verifySchedule,modes}={}) {
  if (!id(briefingId)) throw new Error('Invalid briefing ID');
  const request = publicationInput(input);
  if(!scheduleId) await domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    if((await client.query('SELECT 1 FROM publication_schedules WHERE id=$1',[input.requestId])).rows.length)throw Error('Publication request conflict');
  });
  const preflight=await publicationPreflight(pool,session,briefingId,input,request,{schema,integrationMode,storage});
  if(preflight?.replay) return preflight.replay;
  return domainTransaction(pool,schema,client=>publishInTransaction(client,session,briefingId,input,
    {integrationMode,preflight,scheduleId,verifySchedule,modes,request}));
}

export async function withdrawPublication(pool,session,briefingId,input,{schema='public'}={}) {
  if (!id(briefingId)) throw new Error('Invalid briefing ID');
  const request=withdrawalInput(input);
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    // Match publication's lock order so replacement and withdrawal serialize on the same briefing.
    const briefing=(await client.query('SELECT id FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',
      [briefingId,session.org_id,session.site_id])).rows[0];
    if (!briefing) throw new Error('Briefing unavailable');
    const publication=(await client.query('SELECT id,version,state FROM publications WHERE id=$1 AND briefing_id=$2 AND org_id=$3 AND site_id=$4 FOR UPDATE',
      [request.publicationId,briefingId,session.org_id,session.site_id])).rows[0];
    if (!publication) throw new Error('Publication unavailable');
    const old=(await client.query('SELECT * FROM publication_withdrawals WHERE request_id=$1 AND org_id=$2 AND site_id=$3',
      [input.requestId,session.org_id,session.site_id])).rows[0];
    if (old) {
      if (old.publication_id!==request.publicationId || old.version!==request.version || old.reason!==request.reason) throw new Error('Withdrawal request conflict');
      return {id:old.publication_id,version:old.version,state:'withdrawn',duplicate:true};
    }
    if (publication.version!==request.version || publication.state!=='published') throw new Error('Publication is no longer current');
    await client.query("UPDATE publications SET state='withdrawn' WHERE id=$1",[publication.id]);
    await client.query(`INSERT INTO publication_withdrawals(request_id,org_id,site_id,publication_id,version,reason,withdrawn_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.requestId,session.org_id,session.site_id,publication.id,publication.version,request.reason,session.principal_id]);
    await domainAudit(client,session,'briefing.withdrawn',publication.id);
    return {id:publication.id,version:publication.version,state:'withdrawn',duplicate:false};
  });
}

export async function submitAnswer(pool,session,assignmentId,submissionId,answerText,{schema='public',presentationId=null}={}) {
  if (!id(assignmentId) || !id(submissionId) || submissionId.length<8 || !nonempty(answerText,2000)) throw new Error('Invalid answer submission');
  const answer = answerText.trim();
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'worker');
    // Serialize all typed/audio receipt acceptance on this assignment, not on timestamps or identity allocation alone.
    const assignment = (await client.query(`SELECT id,publication_id,due_at FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3 AND worker_id=$4 FOR UPDATE`,
      [assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if (!assignment) throw new Error('Assignment unavailable');
    const previous = (await client.query(`SELECT id,answer_text,outcome,assessment_status FROM attempts WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3 AND submission_id=$4`,
      [assignmentId,session.org_id,session.site_id,submissionId])).rows[0];
    if (previous) {
      if (previous.answer_text!==answer) throw new Error('Submission ID conflict');
      return {id:previous.id,outcome:previous.outcome,assessmentStatus:previous.assessment_status,duplicate:true};
    }
    await requireWritableEntitlement(client,session.org_id);
    const publication = (await client.query(`SELECT state,snapshot_json->>'responseMode' AS response_mode,publication_content_available(id) AS content_available
      FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE`,[assignment.publication_id,session.org_id,session.site_id])).rows[0];
    if (publication?.state!=='published' || !publication.content_available) throw new Error('Assignment unavailable');
    if(publication.response_mode==='acknowledge') throw new Error('This instruction only requires confirmation');
    const repeatId=await acceptingRepeat(client,session,assignment);
    if ((await client.query('SELECT 1 FROM recordings WHERE assignment_id=$1 AND submission_id=$2',[assignmentId,submissionId])).rows.length) throw new Error('Submission ID conflict');
    const presentation=await checkedPresentationBinding(client,session,assignmentId,presentationId);
    const attemptId = randomUUID();
    const receipt = (await client.query(`INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
      VALUES ($1,$2,$3,'typed',clock_timestamp()) RETURNING received_at`,[session.org_id,assignmentId,submissionId])).rows[0];
    await client.query(`INSERT INTO attempts(id,org_id,site_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at,assessment_status)
      VALUES ($1,$2,$3,$4,$5,$6,NULL,'[]',$7,'pending')`,[attemptId,session.org_id,session.site_id,assignmentId,submissionId,answer,receipt.received_at]);
    await client.query(`INSERT INTO assessment_jobs(id,org_id,site_id,assignment_id,attempt_id) VALUES ($1,$2,$3,$4,$5)`,[randomUUID(),session.org_id,session.site_id,assignmentId,attemptId]);
    await recordPresentationBinding(client,attemptId,presentation);
    await consumeRepeat(client,repeatId,submissionId,receipt.received_at);
    await domainAudit(client,session,'answer.received',attemptId);
    return {id:attemptId,outcome:null,assessmentStatus:'pending',duplicate:false};
  });
}
