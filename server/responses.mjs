import { NOW,transaction } from './db.mjs';
import { responseColumns,isCurrentRecording } from './recordings.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {ensureCaseMessageSchema} from './case-messages.mjs';
import {workerCredentialSessionValid} from './auth.mjs';
import {WORKER_LANGUAGE_CODES} from './languages.mjs';

const present=(db,name)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

export const workerFollowupPredicate=`p.state='published' AND EXISTS(SELECT 1 FROM clarifications c JOIN case_messages m ON m.case_id=c.id AND m.org_id=c.org_id
  WHERE c.assignment_id=a.id AND c.org_id=a.org_id AND m.site_id=a.site_id AND m.assignment_id=a.id AND c.status='open' AND m.actor_type='staff')`;

export function responseFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some((key) => !['search','language','status','page','pageSize'].includes(key))) throw new Error('Invalid response filter');
  const {search='',language='all',status='all'}=input,page=Number(input.page ?? 1),pageSize=Number(input.pageSize ?? 20);
  if(typeof search!=='string' || search.length>80 || !['all',...WORKER_LANGUAGE_CODES].includes(language)
    || !['all','awaiting_response','assessment_pending','matched','clarification','unassessable','acknowledged','failed_audio'].includes(status)
    || !Number.isSafeInteger(page) || page<1 || page>5000 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>50) throw new Error('Invalid response filter');
  return {search:search.trim(),language,status,page,pageSize};
}

export function responseRequest(publicationId,assignmentId,input,detail=false) {
  if(typeof publicationId!=='string' || !publicationId || publicationId.length>100
    || (detail && (typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100))) throw new Error('Invalid response filter');
  return detail ? submissionFilters(input) : responseFilters(input);
}

export function submissionFilters(input={}) {
  const filters=responseFilters(input);
  if(Object.keys(input).some((key) => !['page','pageSize'].includes(key))) throw new Error('Invalid response filter');
  return filters;
}

export function assignmentRequest(workerId,input={}) {
  if(typeof workerId!=='string' || !workerId || workerId.length>100) throw new Error('Invalid response filter');
  return submissionFilters(input);
}

export function workerInboxFilters(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some((key) => !['view','page','pageSize'].includes(key))) throw new Error('Invalid response filter');
  const {view='all',...paging}=input;
  if(!['all','todo','sent','followup'].includes(view)) throw new Error('Invalid response filter');
  const {page,pageSize}=submissionFilters(paging);
  return {view,page,pageSize};
}

export function workerBriefingRow(row) {
  const delivered=typeof row.delivery_content_json==='string' ? JSON.parse(row.delivery_content_json) : row.delivery_content_json;
  const language=delivered || (typeof row.languages==='string' ? JSON.parse(row.languages) : row.languages)?.[row.language];
  const expired=row.content_expired===true;
  if(!language && !expired) throw new Error('Assignment language unavailable');
  const audio=isCurrentRecording(row),acknowledged=!!row.acknowledged_at;
  return {id:row.id,publicationId:row.publication_id,version:row.version,state:row.state,title:expired?'[Expired]':language.title,language:row.language,
    ...(expired?{contentExpired:true}:{}),
    ...(row.repeat_request?{repeatRequest:row.repeat_request}:{}),responseMode:row.response_mode||'question',deliveryMode:row.delivery_mode||'both',
    dueAt:row.due_at instanceof Date ? row.due_at.toISOString() : row.due_at || null,outcome:audio ? null : row.outcome || null,
    assessmentStatus:audio || (row.attempt_at && !row.outcome) ? 'pending' : acknowledged || row.outcome ? 'complete' : null,audioStatus:audio ? row.audio_status : null,
    ...(acknowledged?{acknowledgedAt:row.acknowledged_at instanceof Date?row.acknowledged_at.toISOString():row.acknowledged_at}:{}),
    ...(row.reminder_at?{reminderAt:row.reminder_at instanceof Date?row.reminder_at.toISOString():row.reminder_at}:{})};
}

export function workerInboxPage(rows,counts,filters,history,asOf) {
  const {view,page,pageSize}=filters;
  return {items:rows.map(workerBriefingRow),total:view==='todo' ? counts.todo : view==='sent' ? counts.sent : view==='followup' ? counts.followup : history ? counts.history : counts.current,
    counts:{todo:counts.todo,sent:counts.sent,history:counts.history,followup:counts.followup},page,pageSize,asOf};
}

export function workerAssignmentRow(row) {
  return {...responseRow(row),publicationId:row.publication_id,title:row.title,version:row.version,state:row.state,
    dueAt:row.due_at instanceof Date ? row.due_at.toISOString() : row.due_at || null};
}

export function responseRow(row) {
  const audio=isCurrentRecording(row),outcome=audio ? null : row.outcome;
  const acknowledgedAt=audio ? null : row.acknowledged_at;
  const receivedAt=audio ? row.audio_at : row.attempt_at || acknowledgedAt;
  return {assignmentId:row.assignment_id,worker:row.code,language:row.language,
    status:outcome || (audio && row.audio_status==='failed' ? 'failed_audio' : acknowledgedAt ? 'acknowledged' : receivedAt ? 'assessment_pending' : 'awaiting_response'),
    outcome:outcome || null,receivedAt:receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt || null};
}

export function responsePage(rows,filters,publication) {
  if(rows.length>5000) throw new Error('Response audience exceeds limit');
  // ponytail: publication caps audiences at 5000; filter this bounded metadata set, use SQL paging if that cap grows.
  const {search,language,status,page,pageSize}=filters;
  const filtered=rows.map(responseRow).filter((row) => row.worker.toLowerCase().includes(search.toLowerCase())
    && (language==='all' || language===row.language) && (status==='all' || status===row.status));
  return {publication,items:filtered.slice((page-1)*pageSize,page*pageSize),total:filtered.length,page,pageSize};
}

export function receiptRow(row,latest) {
  const json=(value) => typeof value==='string' ? JSON.parse(value) : value;
  return {sequence:String(row.sequence),kind:row.kind,receivedAt:row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
    isLatest:String(row.sequence)===String(latest),answerText:row.answer_text ?? row.transcript ?? null,
    outcome:row.outcome || null,reasons:json(row.reasons_json) || [],evidence:json(row.evidence_json) || [],
    recordingId:row.recording_id || null,audioStatus:row.audio_status || null};
}

export function workerReceiptRow(row,latest) {
  return {id:row.submission_id,kind:row.kind,receivedAt:row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
    isLatest:String(row.sequence)===String(latest),answerText:row.answer_text ?? row.transcript ?? null,
    outcome:row.outcome || null,recordingId:row.recording_id || null,audioStatus:row.audio_status || null};
}

export function workerRequestReceiptInput(assignmentId,kind,requestId) {
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100 || !['answer','help','audio','acknowledge'].includes(kind)
    || typeof requestId!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId))throw Error('Invalid response filter');
}

export function workerRequestReceiptRow(row,kind) {
  if(!row)throw Error('Response unavailable');
  if(kind==='answer')return {id:row.id,outcome:row.outcome || null,assessmentStatus:row.assessment_status || 'complete',duplicate:true};
  if(kind==='help')return {id:row.id,status:row.status,duplicate:true};
  if(kind==='acknowledge')return {id:row.id,status:'acknowledged',receivedAt:row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,duplicate:true};
  return {id:row.id,status:row.status,receivedAt:row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,duplicate:true};
}

function authority(db,session,type='staff') {
  if(session?.principal_type!==type || (type==='staff' && !['owner','supervisor','auditor'].includes(session.role))) throw new Error('Forbidden');
  if(type==='worker')requireWorkerSiteAccess(db,session.org_id,session.site_id);
  if(!db.prepare(`SELECT id FROM ${type==='staff' ? 'staff' : 'workers'} WHERE id=? AND org_id=? AND site_id=? AND active=1 ${type==='staff' ? 'AND role=?' : ''}`)
    .get(session.principal_id,session.org_id,session.site_id,...(type==='staff' ? [session.role] : []))) throw new Error('Forbidden');
  if(type==='worker' && session.access_mode==='credential' && !workerCredentialSessionValid(db, session)) throw new Error('Forbidden');
}

function submissionHistory(db,session,assignmentId,page,pageSize,privateDetails,submissionId) {
  const receipt=db.prepare('SELECT COUNT(*) AS total,MAX(sequence) AS latest FROM submission_receipts WHERE assignment_id=? AND org_id=?').get(assignmentId,session.org_id);
  const rows=db.prepare(`SELECT sr.sequence,sr.submission_id,sr.kind,sr.received_at,t.answer_text,t.outcome,${privateDetails ? 't.reasons_json,' : ''}
    r.id AS recording_id,r.status AS audio_status,r.transcript,r.duration_seconds FROM submission_receipts sr
    LEFT JOIN attempts t ON t.assignment_id=sr.assignment_id AND t.submission_id=sr.submission_id AND t.org_id=sr.org_id
    LEFT JOIN recordings r ON r.assignment_id=sr.assignment_id AND r.submission_id=sr.submission_id AND r.org_id=sr.org_id AND r.site_id=? AND r.received_at IS NOT NULL
    WHERE sr.assignment_id=? AND sr.org_id=? ${submissionId===undefined?'':'AND sr.submission_id=?'} ORDER BY sr.sequence DESC LIMIT ? OFFSET ?`)
    .all(session.site_id,assignmentId,session.org_id,...(submissionId===undefined?[]:[submissionId]),pageSize,(page-1)*pageSize);
  return {receipts:rows.map((row) => submissionId===undefined?(privateDetails ? receiptRow : workerReceiptRow)(row,receipt.latest):{...workerReceiptRow(row,receipt.latest),durationSeconds:row.duration_seconds??null}),total:receipt.total,page,pageSize};
}

export function workerSubmission(db,session,assignmentId,submissionId,input={}){
  workerRequestReceiptInput(assignmentId,'answer',submissionId);submissionFilters(input);
  if(Object.keys(input).length)throw Error('Invalid response filter');
  return transaction(db,()=>{
    authority(db,session,'worker');
    const assignment=db.prepare(`SELECT a.id,a.language,p.version,p.state FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`).get(assignmentId,session.org_id,session.site_id,session.principal_id);
    if(!assignment)throw Error('Response unavailable');
    const receipt=submissionHistory(db,session,assignmentId,1,1,false,submissionId).receipts[0];
    if(!receipt)throw Error('Response unavailable');
    return {assignment,receipt};
  });
}

export function workerSubmissions(db,session,assignmentId,input={}) {
  const {page,pageSize}=submissionFilters(input);
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100) throw new Error('Invalid response filter');
  return transaction(db,() => {
    authority(db,session,'worker');
    const assignment=db.prepare(`SELECT a.id,a.language,p.version,p.state FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`).get(assignmentId,session.org_id,session.site_id,session.principal_id);
    if(!assignment) throw new Error('Response unavailable');
    return {assignment, ...submissionHistory(db,session,assignmentId,page,pageSize,false)};
  });
}

export function workerRequestReceipt(db,session,assignmentId,kind,requestId) {
  workerRequestReceiptInput(assignmentId,kind,requestId);
  return transaction(db,()=>{
    authority(db,session,'worker');
    if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=? AND principal_type='worker'
      AND principal_id=? AND access_mode=? AND revoked_at IS NULL AND expires_at>?`)
      .get(session.token_hash,session.org_id,session.site_id,session.principal_id,session.access_mode,NOW()))throw Error('Sign in required');
    if(!db.prepare(`SELECT 1 FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`).get(assignmentId,session.org_id,session.site_id,session.principal_id))throw Error('Response unavailable');
    let row;
    if(kind==='help')row=db.prepare(`SELECT c.id,c.status FROM help_requests h JOIN clarifications c ON c.id=h.case_id AND c.org_id=h.org_id AND c.assignment_id=h.assignment_id
      WHERE h.assignment_id=? AND h.org_id=? AND h.site_id=? AND h.case_id=?`).get(assignmentId,session.org_id,session.site_id,requestId);
    else if(kind==='acknowledge')row=db.prepare('SELECT request_id AS id,received_at FROM acknowledgments WHERE assignment_id=? AND org_id=? AND site_id=? AND request_id=?')
      .get(assignmentId,session.org_id,session.site_id,requestId);
    else if(kind==='answer')row=db.prepare(`SELECT t.id,t.outcome FROM submission_receipts sr JOIN attempts t ON t.assignment_id=sr.assignment_id AND t.org_id=sr.org_id AND t.submission_id=sr.submission_id
      WHERE sr.assignment_id=? AND sr.org_id=? AND sr.submission_id=? AND sr.kind='typed'`).get(assignmentId,session.org_id,requestId);
    else row=db.prepare(`SELECT r.id,r.status,r.received_at FROM submission_receipts sr JOIN recordings r ON r.assignment_id=sr.assignment_id AND r.org_id=sr.org_id AND r.submission_id=sr.submission_id
      WHERE sr.assignment_id=? AND sr.org_id=? AND sr.submission_id=? AND sr.kind='audio' AND r.site_id=? AND r.received_at IS NOT NULL`)
      .get(assignmentId,session.org_id,requestId,session.site_id);
    return workerRequestReceiptRow(row,kind);
  });
}

export function workerBriefings(db,session,input={},history=false) {
  const filters=workerInboxFilters(input),{view,page,pageSize}=filters;
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='case_messages'").get()) {
    authority(db,session,'worker');ensureCaseMessageSchema(db);
  }
  return transaction(db,() => {
    authority(db,session,'worker');const now=NOW();
    const scope=`FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.org_id=? AND a.site_id=? AND a.worker_id=?`;
    const accepted='(EXISTS(SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=a.id AND sr.org_id=a.org_id) OR EXISTS(SELECT 1 FROM acknowledgments ak WHERE ak.assignment_id=a.id AND ak.org_id=a.org_id))';
    const counts=db.prepare(`SELECT COUNT(*) AS history,COALESCE(SUM(p.state='published'),0) AS current,
      COALESCE(SUM(${workerFollowupPredicate}),0) AS followup,
      COALESCE(SUM(${accepted}),0) AS sent,COALESCE(SUM(p.state='published' AND (a.due_at IS NULL OR a.due_at>?) AND NOT ${accepted}),0) AS todo ${scope}`)
      .get(now,session.org_id,session.site_id,session.principal_id);
    const rows=db.prepare(`SELECT a.id,a.due_at,a.language,p.id AS publication_id,p.version,p.state,
      CASE WHEN p.state='published' AND a.due_at>? AND NOT ${accepted} THEN
        (SELECT r.finished_at FROM assignment_reminders r WHERE r.assignment_id=a.id AND r.org_id=a.org_id AND r.site_id=a.site_id AND r.worker_id=a.worker_id AND r.state='visible') END AS reminder_at,
      ${present(db,'instruction_deliveries') ? `(SELECT d.content_json FROM instruction_deliveries d
        WHERE d.assignment_id=a.id AND d.org_id=a.org_id AND d.site_id=a.site_id AND d.worker_id=a.worker_id
          AND d.state='available') AS delivery_content_json,` : ''}
      json_extract(p.snapshot_json,'$.languages') AS languages,
      json_extract(p.snapshot_json,'$.responseMode') AS response_mode,json_extract(p.snapshot_json,'$.deliveryMode') AS delivery_mode,
      ${responseColumns} ${scope}
      AND (?=1 OR p.state='published') AND (?='all' OR (?='sent' AND ${accepted})
        OR (?='todo' AND p.state='published' AND (a.due_at IS NULL OR a.due_at>?) AND NOT ${accepted}) OR (?='followup' AND ${workerFollowupPredicate}))
      ORDER BY p.published_at DESC,p.id DESC,a.id DESC LIMIT ? OFFSET ?`)
      .all(now,session.org_id,session.site_id,session.principal_id,history || view==='sent' ? 1 : 0,view,view,view,now,view,pageSize,(page-1)*pageSize);
    return workerInboxPage(rows,counts,filters,history,now);
  });
}

function scopedPublication(db,session,id) {
  const row=db.prepare('SELECT id,briefing_id,version,state,snapshot_json FROM publications WHERE id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
  if(!row) throw new Error('Publication unavailable');
  const snapshot=JSON.parse(row.snapshot_json);
  return {publication:{id:row.id,briefingId:row.briefing_id,version:row.version,state:row.state,title:snapshot.title},snapshot};
}

export function staffWorkerAssignments(db,session,workerId,input={}) {
  const {page,pageSize}=assignmentRequest(workerId,input);
  return transaction(db,() => {
    if(!['owner','supervisor'].includes(session?.role)) throw new Error('Forbidden');
    authority(db,session);
    const worker=db.prepare('SELECT id,code,active FROM workers WHERE id=? AND org_id=? AND site_id=?').get(workerId,session.org_id,session.site_id);
    if(!worker) throw new Error('Worker unavailable');
    const total=db.prepare('SELECT COUNT(*) n FROM assignments WHERE worker_id=? AND org_id=? AND site_id=?').get(workerId,session.org_id,session.site_id).n;
    const rows=db.prepare(`SELECT a.id AS assignment_id,a.publication_id,a.language,a.due_at,w.code,
      p.version,p.state,json_extract(p.snapshot_json,'$.title') AS title,${responseColumns}
      FROM assignments a JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.worker_id=? AND a.org_id=? AND a.site_id=? ORDER BY p.published_at DESC,p.id DESC,a.id DESC LIMIT ? OFFSET ?`)
      .all(workerId,session.org_id,session.site_id,pageSize,(page-1)*pageSize);
    return {worker:{id:worker.id,code:worker.code,active:Boolean(worker.active)},items:rows.map(workerAssignmentRow),total,page,pageSize};
  });
}

export function listPublicationResponses(db,session,publicationId,input={}) {
  const filters=responseRequest(publicationId,null,input);
  return transaction(db,() => {
    authority(db,session);const {publication}=scopedPublication(db,session,publicationId);
    const rows=db.prepare(`SELECT a.id AS assignment_id,w.code,a.language,${responseColumns}
      FROM assignments a JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      WHERE a.publication_id=? AND a.org_id=? AND a.site_id=? ORDER BY w.code,a.id LIMIT 5001`).all(publicationId,session.org_id,session.site_id);
    return responsePage(rows,filters,publication);
  });
}

export function getPublicationResponse(db,session,publicationId,assignmentId,input={}) {
  const {page,pageSize}=responseRequest(publicationId,assignmentId,input,true);
  return transaction(db,() => {
    authority(db,session);const {publication,snapshot}=scopedPublication(db,session,publicationId);
    const assignment=db.prepare(`SELECT a.id,a.worker_id,w.code AS worker,a.language,a.due_at FROM assignments a JOIN workers w
      ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id WHERE a.id=? AND a.publication_id=? AND a.org_id=? AND a.site_id=?`)
      .get(assignmentId,publicationId,session.org_id,session.site_id);
    if(!assignment) throw new Error('Response unavailable');
    const delivered=present(db,'instruction_deliveries')
      ? db.prepare(`SELECT language,content_json FROM instruction_deliveries WHERE assignment_id=? AND org_id=? AND site_id=? AND worker_id=? AND state='available'`)
        .get(assignmentId,session.org_id,session.site_id,assignment.worker_id)
      : null;
    let deliveredContent=null;
    if(delivered?.language===assignment.language && delivered.content_json) {
      try{deliveredContent=JSON.parse(delivered.content_json);}catch{deliveredContent=null;}
    }
    const cases=db.prepare('SELECT id,status,reason FROM clarifications WHERE assignment_id=? AND org_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(assignmentId,session.org_id);
    const acknowledgment=db.prepare('SELECT received_at FROM acknowledgments WHERE assignment_id=? AND org_id=? AND site_id=?')
      .get(assignmentId,session.org_id,session.site_id);
    const responseMode=snapshot.responseMode || 'question',deliveryMode=snapshot.deliveryMode || 'both';
    return {publication,assignment:{id:assignment.id,worker:assignment.worker,language:assignment.language,dueAt:assignment.due_at},
      question:responseMode==='acknowledge'?null:snapshot.question,facts:snapshot.facts,
      workerQuestion:responseMode==='acknowledge'?null:deliveredContent?.question || snapshot.languages?.[assignment.language]?.question || null,
      responseMode,deliveryMode,
      acknowledgedAt:acknowledgment?.received_at || null,
      ...submissionHistory(db,session,assignmentId,page,pageSize,true),cases};
  });
}
