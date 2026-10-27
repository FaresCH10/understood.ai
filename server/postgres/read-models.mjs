import { domainTransaction,requirePrincipal } from './domain.mjs';
import { postgresResponseColumns as responseColumns,isCurrentRecording } from '../recordings.mjs';
import { metricsFromResponses } from '../domain.mjs';
import { publicationResponses } from './reports.mjs';
import { briefingFilters } from '../briefing-input.mjs';
import { processingFilters,processingJob,processingJobId } from '../processing.mjs';
import {processingRowsSql} from '../processing-rows.mjs';
import { workerInboxFilters,workerInboxPage,workerFollowupPredicate } from '../responses.mjs';
import { responseRead } from './responses.mjs';
import {billingRecoveryScope} from '../billing-input.mjs';
import {templateRecoveryScope} from '../template-input.mjs';
import {staffRecoveryScope} from '../staff-input.mjs';
import {staffSiteScope} from '../account-input.mjs';
import {staffArtifactUrls,draftGeneratedEvidence} from './generated-audio.mjs';
import {preparationProgress} from './preparation-progress.mjs';
import {getDraftLanguageSelection} from './settings.mjs';
import {siteLifecycleState} from './site-lifecycle.mjs';
import {pendingRepeatColumns,pendingRepeatPredicate} from './case-repeats.mjs';

const readRoles=['owner','supervisor','auditor'];
const iso=(value) => value instanceof Date ? value.toISOString() : value;

export async function sessionContext(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,session.principal_type,[...readRoles,'administrator']);
    const {staff_interface_language,first_run_completed_at,has_site_settings,...context}=(await client.query(`SELECT o.name AS organization,st.name AS site,st.timezone,
      ss.staff_interface_language,ss.first_run_completed_at,(ss.site_id IS NOT NULL) AS has_site_settings FROM organizations o
      JOIN sites st ON st.org_id=o.id LEFT JOIN site_settings ss ON ss.site_id=st.id AND ss.org_id=st.org_id
      WHERE o.id=$1 AND st.id=$2`,[session.org_id,session.site_id])).rows[0];
    return {...context,siteState:(await siteLifecycleState(client,session.org_id,session.site_id)).state,role:session.principal_type,staffRole:session.principal_type==='staff' ? session.role : null,email:session.principal_type==='staff' ? session.email ?? null : null,staffInterfaceLanguage:session.principal_type==='staff' ? staff_interface_language ?? 'en' : null,firstRunRequired:session.principal_type==='staff' && session.role==='owner' && has_site_settings===true && first_run_completed_at===null,staffScope:staffSiteScope(session),staffRecoveryScope:staffRecoveryScope(session),billingRecoveryScope:billingRecoveryScope(session),templateRecoveryScope:templateRecoveryScope(session),name:session.name || session.code,language:session.language || 'en',languageSelectionRequired:session.principal_type==='worker' ? !!session.language_selection_required : false,languageSelectedAt:session.principal_type==='worker' ? session.language_selected_at ?? null : null,languageSelectedBy:session.principal_type==='worker' ? session.language_selected_by ?? null : null,workerId:session.principal_type==='worker' ? session.principal_id : null};
  });
}

export async function listBriefings(pool,session,filters={}, {schema='public'}={}) {
  const {search,status,publicationStatus,scheduleStatus,archiveStatus,sort,page,pageSize}=briefingFilters(filters);
  const order={updated:'updated_at DESC,id',oldest:'updated_at,id',title:'lower(title),id'}[sort];
  const aggregateOrder={updated:'result.updated_at DESC,result.id',oldest:'result.updated_at,result.id',title:'lower(result.title),result.id'}[sort];
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',readRoles);
    const row=(await client.query(`WITH scoped AS (
      SELECT b.id,b.title,b.state,b.revision,b.next_version,b.updated_at,p.version AS published_version,p.state AS publication_state,p.id AS latest_publication_id,p.snapshot_json->'languages' AS languages,a.occurred_at AS archived_at,s.state AS schedule_state,s.publish_at AS scheduled_for
      FROM briefings b LEFT JOIN LATERAL (SELECT id,version,state,snapshot_json FROM publications
        WHERE briefing_id=b.id AND org_id=b.org_id AND site_id=b.site_id ORDER BY version DESC LIMIT 1) p ON true
      LEFT JOIN briefing_archives a ON a.briefing_id=b.id AND a.org_id=b.org_id AND a.site_id=b.site_id
      LEFT JOIN LATERAL (SELECT state,publish_at FROM publication_schedules WHERE briefing_id=b.id AND org_id=b.org_id
        AND site_id=b.site_id ORDER BY CASE WHEN state='queued' THEN 0 ELSE 1 END,created_at DESC,id LIMIT 1) s ON true
      WHERE b.org_id=$1 AND b.site_id=$2), filtered AS (
      SELECT * FROM scoped WHERE ($3='' OR strpos(lower(title),lower($3))>0) AND ($4='all' OR state=$4)
        AND ($5='all' OR publication_state=$5 OR ($5='unpublished' AND published_version IS NULL))
        AND ($9='all' OR schedule_state=$9 OR ($9='none' AND schedule_state IS NULL))
        AND ($8='all' OR ($8='active' AND archived_at IS NULL) OR ($8='archived' AND archived_at IS NOT NULL)))
      SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
        (SELECT COALESCE(jsonb_agg(result ORDER BY ${aggregateOrder}),'[]') FROM (SELECT * FROM filtered ORDER BY ${order} LIMIT $6 OFFSET $7) result) AS items`,
      [session.org_id,session.site_id,search,status,publicationStatus,pageSize,(page-1)*pageSize,archiveStatus,scheduleStatus])).rows[0];
    const items=[];
    for(const item of row.items){
      const {latest_publication_id,languages,...rest}=item;
      items.push({...rest,languages:Object.keys(languages || {}),metrics:latest_publication_id?metricsFromResponses(await publicationResponses(client,session,latest_publication_id)):null});
    }
    const counts=(await client.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE b.state='processing')::int AS processing,COUNT(*) FILTER (WHERE b.state='ready')::int AS ready,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM briefing_archives a WHERE a.briefing_id=b.id AND a.org_id=b.org_id AND a.site_id=b.site_id))::int AS archived,
      COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM publications p WHERE p.briefing_id=b.id AND p.org_id=b.org_id AND p.site_id=b.site_id
        AND p.version=(SELECT MAX(latest.version) FROM publications latest WHERE latest.briefing_id=b.id AND latest.org_id=b.org_id AND latest.site_id=b.site_id) AND p.state='published'))::int AS published
      FROM briefings b WHERE b.org_id=$1 AND b.site_id=$2`,[session.org_id,session.site_id])).rows[0];
    return {...row,items,page,pageSize,counts};
  });
}

export async function getBriefing(pool,session,briefingId,{schema='public'}={}) {
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',readRoles);
    const row=(await client.query(`SELECT id,title,source,revision,next_version,state,prepared_json AS prepared,created_at,updated_at
      FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3`,[briefingId,session.org_id,session.site_id])).rows[0];
    if (!row) throw new Error('Briefing unavailable');
    row.contentExpired=(await client.query('SELECT 1 FROM briefing_content_purges WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[briefingId,session.org_id,session.site_id])).rows.length>0;
    row.generationLanguages=await getDraftLanguageSelection(client,session.org_id,session.site_id,briefingId);
    const review=row.contentExpired?null:(await client.query('SELECT content_json FROM draft_reviews WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',[briefingId,session.org_id,session.site_id])).rows[0]?.content_json || null;
    const archive=(await client.query("SELECT request_json->>'reason' AS reason,archived_by,occurred_at FROM briefing_archives WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3",[briefingId,session.org_id,session.site_id])).rows[0];
    const publications=(await client.query(`SELECT p.id,p.version,p.snapshot_json AS snapshot,p.published_at,p.state,
      CASE WHEN w.publication_id IS NULL THEN NULL ELSE jsonb_build_object('reason',w.reason,'withdrawn_by',w.withdrawn_by,'occurred_at',w.occurred_at) END AS withdrawal
      FROM publications p LEFT JOIN publication_withdrawals w ON w.publication_id=p.id AND w.org_id=p.org_id AND w.site_id=p.site_id
      WHERE p.briefing_id=$1 AND p.org_id=$2 AND p.site_id=$3 ORDER BY p.version DESC LIMIT 1`,[briefingId,session.org_id,session.site_id])).rows.map((pub) => ({...pub,published_at:iso(pub.published_at)}));
    for(const publication of publications) {
      publication.metrics=metricsFromResponses(await publicationResponses(client,session,publication.id));
      publication.artifactAudio=await staffArtifactUrls(client,session,briefingId,publication.id,publication.snapshot);
    }
    const artifactAudio=await staffArtifactUrls(client,session,briefingId,String(row.revision),row.prepared,row);
    let regenerationLanguages=[],targetRegeneration=null;
    if(['owner','supervisor'].includes(session.role) && !archive) {
      if(row.prepared?.artifactBundle) {
        try {regenerationLanguages=(await draftGeneratedEvidence(client,{...session,briefing_id:briefingId},{...row,prepared_json:row.prepared})).manifest.dependencies.languages;}
        catch(reason) {if(!['Generated bundle unavailable','Artifact audio unavailable'].includes(reason.message)) throw reason;}
      }
      targetRegeneration=(await client.query(`SELECT j.id AS "jobId",j.status,r.request_json->>'language' AS language,r.request_json->>'kind' AS kind
        FROM briefing_regeneration_requests r JOIN jobs j ON j.id=r.job_id AND j.org_id=r.org_id AND j.site_id=r.site_id
        WHERE r.briefing_id=$1 AND r.org_id=$2 AND r.site_id=$3 AND r.accepted_revision=$4`,[briefingId,session.org_id,session.site_id,row.revision])).rows[0] || null;
    }
    return {...row,artifactAudio,regenerationLanguages,targetRegeneration,review,created_at:iso(row.created_at),updated_at:iso(row.updated_at),publications,archive:archive ? {...archive,occurred_at:iso(archive.occurred_at)} : null};
  });
}

export async function staffOverview(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',readRoles);
    const context=(await client.query(`SELECT o.name AS organization,s.name AS site,s.timezone FROM organizations o
      JOIN sites s ON s.org_id=o.id WHERE o.id=$1 AND s.id=$2`,[session.org_id,session.site_id])).rows[0];
    const publication=(await client.query(`SELECT id,briefing_id AS "briefingId",version,snapshot_json->>'title' AS title FROM publications
      WHERE org_id=$1 AND site_id=$2 AND state='published' ORDER BY published_at DESC,id LIMIT 1`,[session.org_id,session.site_id])).rows[0] || null;
    const metrics=metricsFromResponses(publication ? await publicationResponses(client,session,publication.id) : []);
    const cases=(await client.query(`SELECT c.id,c.reason,c.status,c.created_at,w.code AS worker,a.language,p.snapshot_json->>'title' AS title
      FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id AND a.site_id=c.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE c.org_id=$1 AND c.site_id=$2 AND c.status='open' ORDER BY c.created_at DESC,c.id DESC LIMIT 5`,[session.org_id,session.site_id])).rows.map((row) => ({...row,created_at:iso(row.created_at)}));
    const asOf=new Date().toISOString(),date=new Intl.DateTimeFormat('en',{timeZone:context.timezone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(asOf));
    return {...context,metrics,cases,publication,date,asOf,demo:false};
  });
}

export async function listProcessing(pool,session,input={},{schema='public'}={}) {
  const {search,status,kind,sort,page,pageSize}=processingFilters(input);
  const order=sort==='newest' ? 'created_at DESC,id' : 'created_at,id';
  const aggregateOrder=sort==='newest' ? 'result.created_at DESC,result.id' : 'result.created_at,result.id';
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',readRoles);
    const row=(await client.query(`${processingRowsSql('postgres')},filtered AS (SELECT * FROM processing_rows
      WHERE org_id=$1 AND site_id=$2 AND ($4='' OR strpos(lower(title),lower($4))>0) AND ($5='all' OR status=$5) AND ($6='all' OR kind=$6))
      SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
        (SELECT COALESCE(jsonb_agg(result ORDER BY ${aggregateOrder}),'[]') FROM (SELECT * FROM filtered ORDER BY ${order} LIMIT $7 OFFSET $8) result) AS items`,
      [session.org_id,session.site_id,session.principal_id,search,status,kind,pageSize,(page-1)*pageSize])).rows[0];
    return {items:row.items.map(processingJob),total:row.total,page,pageSize};
  });
}

export async function getProcessing(pool,session,id,{schema='public'}={}) {
  processingJobId(id);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',readRoles);
    const row=(await client.query(`${processingRowsSql('postgres')} SELECT * FROM processing_rows
      WHERE org_id=$1 AND site_id=$2 AND id=$4`,[session.org_id,session.site_id,session.principal_id,id])).rows[0];
    if(!row) throw new Error('Processing job unavailable');
    return {...processingJob(row),...(row.kind==='prepare'?{progress:await preparationProgress(client,session,row)}:{})};
  });
}

function workerContent(row,detail=false) {
  const currentAudio=isCurrentRecording(row), lang=row.delivery_content_json || row.languages?.[row.language],expired=row.content_expired===true;
  if (!lang && !expired) throw new Error('Assignment language unavailable');
  const responseMode=row.response_mode||'question',deliveryMode=row.delivery_mode||'both',acknowledgedAt=iso(row.acknowledged_at);
  const generatedSpeech=!expired && deliveryMode!=='text' && !!lang?.speech && typeof lang.speech==='object'
    && !!lang.speech.body && !!lang.speech.question;
  const deviceSpeech=!expired && deliveryMode!=='text' && lang?.speech==='device-synthesis-demo';
  const speechOffered=deviceSpeech;
  // Explicit DTO: do not spread publication JSON or return internal reasons/rubric/notes/storage references.
  return {id:row.id,publicationId:row.publication_id,version:row.version,state:row.state,title:expired?'[Expired]':lang.title,language:row.language,
    ...(expired?{contentExpired:true}:{}),
    dueAt:iso(row.due_at),...(row.repeat_request?{repeatRequest:row.repeat_request}:{}),responseMode,deliveryMode,
    outcome:responseMode==='acknowledge' ? null : currentAudio ? null : row.outcome,
    assessmentStatus:responseMode==='acknowledge' ? acknowledgedAt ? 'complete' : null
      : currentAudio || (row.attempt_at && !row.outcome) ? 'pending' : row.outcome ? 'complete' : null,
    ...(acknowledgedAt?{acknowledgedAt}:{}),
    audioStatus:currentAudio ? row.audio_status : null,...(detail ? {recordingId:currentAudio ? row.recording_id : null,
      content:expired?null:{title:lang.title,text:lang.text,...(responseMode==='question'?{question:lang.question,...(lang.questionType==='multiple-choice'?{questionType:lang.questionType,choices:lang.choices}:{})}:{}),speech:speechOffered ? lang.speech : null},
      ...(!expired && row.speech_active===true && generatedSpeech && lang.speech?.body && lang.speech?.question ? {speechUrls:{body:`/api/worker/briefings/${encodeURIComponent(row.id)}/speech/body`,question:`/api/worker/briefings/${encodeURIComponent(row.id)}/speech/question`}} : {}),
      speechAvailable:speechOffered ? 'speechSynthesis' : null} : {})};
}

export async function workerBriefings(pool,session,{schema='public',history=false}={},input={}) {
  const filters=workerInboxFilters(input),{view,page,pageSize}=filters;
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'worker');
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
    const scope=`FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.org_id=$1 AND a.site_id=$2 AND a.worker_id=$3`;
    const accepted='(EXISTS(SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=a.id AND sr.org_id=a.org_id) OR EXISTS(SELECT 1 FROM acknowledgments ak WHERE ak.assignment_id=a.id AND ak.org_id=a.org_id))';
    const available="p.state='published' AND publication_content_available(p.id)";
    const followup=`(${available}) AND (${workerFollowupPredicate} OR ${pendingRepeatPredicate})`;
    const todo=`${available} AND (${pendingRepeatPredicate} OR ((a.due_at IS NULL OR a.due_at>$4::timestamptz) AND NOT ${accepted}))`;
    const counts=(await client.query(`SELECT COUNT(*)::int AS history,COUNT(*) FILTER(WHERE ${available})::int AS current,
      COUNT(*) FILTER(WHERE ${accepted})::int AS sent,COUNT(*) FILTER(WHERE ${followup})::int AS followup,
      COUNT(*) FILTER(WHERE ${todo})::int AS todo ${scope}`,
      [session.org_id,session.site_id,session.principal_id,now])).rows[0];
    const rows=(await client.query(`SELECT a.id,a.due_at,p.id AS publication_id,p.version,p.state,p.snapshot_json->'languages' AS languages,a.language,NOT publication_content_available(p.id) AS content_expired,
      p.snapshot_json->>'responseMode' AS response_mode,p.snapshot_json->>'deliveryMode' AS delivery_mode,
      (SELECT d.content_json FROM instruction_deliveries d WHERE d.assignment_id=a.id AND d.org_id=a.org_id
        AND d.site_id=a.site_id AND d.worker_id=a.worker_id AND d.state='available') AS delivery_content_json,
      ${pendingRepeatColumns},
      CASE WHEN ${available} AND a.due_at>$6::timestamptz AND NOT ${accepted} THEN
        (SELECT r.finished_at FROM assignment_reminders r WHERE r.assignment_id=a.id AND r.org_id=a.org_id AND r.site_id=a.site_id AND r.worker_id=a.worker_id AND r.state='visible') END AS reminder_at,
      ${responseColumns} ${scope}
      AND ($4 OR (${available})) AND ($5='all' OR ($5='sent' AND ${accepted})
        OR ($5='todo' AND (${available}) AND (${pendingRepeatPredicate} OR ((a.due_at IS NULL OR a.due_at>$6::timestamptz) AND NOT ${accepted}))) OR ($5='followup' AND ${followup}))
      ORDER BY p.published_at DESC,p.id DESC,a.id DESC LIMIT $7 OFFSET $8`,
      [session.org_id,session.site_id,session.principal_id,history || view==='sent',view,now,pageSize,(page-1)*pageSize])).rows;
    return workerInboxPage(rows,counts,filters,history,now);
  });
}

export async function workerBriefing(pool,session,assignmentId,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'worker');
    const row=(await client.query(`SELECT a.id,a.due_at,p.id AS publication_id,p.version,p.state,p.snapshot_json->'languages' AS languages,a.language,NOT publication_content_available(p.id) AS content_expired,
      p.snapshot_json->>'responseMode' AS response_mode,p.snapshot_json->>'deliveryMode' AS delivery_mode,
      d.content_json AS delivery_content_json,
      (gb.state='attached') AS speech_active,${pendingRepeatColumns},${responseColumns}
      FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      LEFT JOIN generated_bundles gb ON gb.id::text=p.snapshot_json->'artifactBundle'->>'id' AND gb.org_id=p.org_id AND gb.site_id=p.site_id
      LEFT JOIN instruction_deliveries d ON d.assignment_id=a.id AND d.org_id=a.org_id AND d.site_id=a.site_id
        AND d.worker_id=a.worker_id AND d.state='available'
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4`,[assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if (!row) throw new Error('Assignment unavailable');
    return workerContent(row,true);
  });
}
