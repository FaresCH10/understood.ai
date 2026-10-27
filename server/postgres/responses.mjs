import { requirePrincipal } from './domain.mjs';
import { withTransaction } from './db.mjs';
import { schemaName } from './migrate.mjs';
import { publicationResponses } from './reports.mjs';
import { responseRequest,responsePage,receiptRow,workerReceiptRow,submissionFilters,assignmentRequest,workerAssignmentRow,workerRequestReceiptInput,workerRequestReceiptRow } from '../responses.mjs';
import { postgresResponseColumns as responseColumns } from '../recordings.mjs';

export function responseRead(pool,schema,fn) {
  schemaName(schema);
  return withTransaction(pool,async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await client.query(`SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true),
      set_config('lock_timeout','5s',true),set_config('statement_timeout','10s',true)`,[schema]);
    return fn(client);
  });
}

async function scopedPublication(client,session,id) {
  const row=(await client.query('SELECT id,briefing_id,version,state,snapshot_json FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3',
    [id,session.org_id,session.site_id])).rows[0];
  if(!row) throw new Error('Publication unavailable');
  return {publication:{id:row.id,briefingId:row.briefing_id,version:row.version,state:row.state,title:row.snapshot_json.title},snapshot:row.snapshot_json};
}

async function submissionHistory(client,session,assignmentId,page,pageSize,privateDetails,submissionId) {
  const receipt=(await client.query('SELECT COUNT(*)::int AS total,MAX(sequence) AS latest FROM submission_receipts WHERE assignment_id=$1 AND org_id=$2',[assignmentId,session.org_id])).rows[0];
  const rows=(await client.query(`SELECT sr.sequence,sr.submission_id,sr.kind,sr.received_at,t.answer_text,t.outcome,${privateDetails ? 't.reasons_json,t.evidence_json,' : ''}
    r.id AS recording_id,r.status AS audio_status,r.transcript,r.duration_seconds FROM submission_receipts sr
    LEFT JOIN attempts t ON t.assignment_id=sr.assignment_id AND t.submission_id=sr.submission_id AND t.org_id=sr.org_id AND t.site_id=$3
    LEFT JOIN recordings r ON r.assignment_id=sr.assignment_id AND r.submission_id=sr.submission_id AND r.org_id=sr.org_id AND r.site_id=$3 AND r.received_at IS NOT NULL
    WHERE sr.assignment_id=$1 AND sr.org_id=$2 ${submissionId===undefined?'':'AND sr.submission_id=$6'} ORDER BY sr.sequence DESC LIMIT $4 OFFSET $5`,[assignmentId,session.org_id,session.site_id,pageSize,(page-1)*pageSize,...(submissionId===undefined?[]:[submissionId])])).rows;
  return {receipts:rows.map((row) => submissionId===undefined?(privateDetails ? receiptRow : workerReceiptRow)(row,receipt.latest):{...workerReceiptRow(row,receipt.latest),durationSeconds:row.duration_seconds??null}),total:receipt.total,page,pageSize};
}

export async function workerSubmission(pool,session,assignmentId,submissionId,input={}, {schema='public'}={}){
  workerRequestReceiptInput(assignmentId,'answer',submissionId);submissionFilters(input);
  if(Object.keys(input).length)throw Error('Invalid response filter');
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    const assignment=(await client.query(`SELECT a.id,a.language,p.version,p.state FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4`,[assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if(!assignment)throw Error('Response unavailable');
    const receipt=(await submissionHistory(client,session,assignmentId,1,1,false,submissionId)).receipts[0];
    if(!receipt)throw Error('Response unavailable');
    return {assignment,receipt};
  });
}

export async function workerSubmissions(pool,session,assignmentId,input={}, {schema='public'}={}) {
  const {page,pageSize}=submissionFilters(input);
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100) throw new Error('Invalid response filter');
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'worker');
    const assignment=(await client.query(`SELECT a.id,a.language,p.version,p.state FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4`,[assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if(!assignment) throw new Error('Response unavailable');
    return {assignment,...await submissionHistory(client,session,assignmentId,page,pageSize,false)};
  });
}

export async function workerRequestReceipt(pool,session,assignmentId,kind,requestId,{schema='public'}={}) {
  workerRequestReceiptInput(assignmentId,kind,requestId);
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    if(!(await client.query(`SELECT 1 FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4`,[assignmentId,session.org_id,session.site_id,session.principal_id])).rows.length)throw Error('Response unavailable');
    const values=[assignmentId,session.org_id,session.site_id,requestId];
    let sql;
    if(kind==='help')sql=`SELECT c.id,c.status FROM help_requests h JOIN clarifications c ON c.id=h.case_id AND c.org_id=h.org_id AND c.site_id=h.site_id AND c.assignment_id=h.assignment_id
      WHERE h.assignment_id=$1 AND h.org_id=$2 AND h.site_id=$3 AND h.case_id=$4`;
    else if(kind==='acknowledge')sql=`SELECT request_id AS id,received_at FROM acknowledgments
      WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3 AND request_id=$4`;
    else if(kind==='answer')sql=`SELECT t.id,t.outcome,t.assessment_status FROM submission_receipts sr JOIN attempts t ON t.assignment_id=sr.assignment_id AND t.org_id=sr.org_id AND t.submission_id=sr.submission_id
      WHERE sr.assignment_id=$1 AND sr.org_id=$2 AND t.site_id=$3 AND sr.submission_id=$4 AND sr.kind='typed'`;
    else sql=`SELECT r.id,r.status,r.received_at FROM submission_receipts sr JOIN recordings r ON r.assignment_id=sr.assignment_id AND r.org_id=sr.org_id AND r.submission_id=sr.submission_id
      WHERE sr.assignment_id=$1 AND sr.org_id=$2 AND r.site_id=$3 AND sr.submission_id=$4 AND sr.kind='audio' AND r.received_at IS NOT NULL`;
    return workerRequestReceiptRow((await client.query(sql,values)).rows[0],kind);
  });
}

export async function listPublicationResponses(pool,session,publicationId,input={}, {schema='public'}={}) {
  const filters=responseRequest(publicationId,null,input);
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const {publication}=await scopedPublication(client,session,publicationId);
    return responsePage(await publicationResponses(client,session,publicationId),filters,publication);
  });
}

export async function staffWorkerAssignments(pool,session,workerId,input={}, {schema='public'}={}) {
  const {page,pageSize}=assignmentRequest(workerId,input);
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',['owner','supervisor']);
    const worker=(await client.query('SELECT id,code,active FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3',[workerId,session.org_id,session.site_id])).rows[0];
    if(!worker) throw new Error('Worker unavailable');
    const total=(await client.query('SELECT COUNT(*)::int n FROM assignments WHERE worker_id=$1 AND org_id=$2 AND site_id=$3',[workerId,session.org_id,session.site_id])).rows[0].n;
    const rows=(await client.query(`SELECT a.id AS assignment_id,a.publication_id,a.language,a.due_at,w.code,
      p.version,p.state,p.snapshot_json->>'title' AS title,${responseColumns}
      FROM assignments a JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.worker_id=$1 AND a.org_id=$2 AND a.site_id=$3 ORDER BY p.published_at DESC,p.id DESC,a.id DESC LIMIT $4 OFFSET $5`,
      [workerId,session.org_id,session.site_id,pageSize,(page-1)*pageSize])).rows;
    return {worker,items:rows.map(workerAssignmentRow),total,page,pageSize};
  });
}

export async function getPublicationResponse(pool,session,publicationId,assignmentId,input={}, {schema='public'}={}) {
  const {page,pageSize}=responseRequest(publicationId,assignmentId,input,true);
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',['owner','supervisor','auditor']);
    const {publication,snapshot}=await scopedPublication(client,session,publicationId);
    const row=(await client.query(`SELECT a.id,w.code AS worker,a.language,a.due_at FROM assignments a JOIN workers w
      ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id WHERE a.id=$1 AND a.publication_id=$2 AND a.org_id=$3 AND a.site_id=$4`,
      [assignmentId,publicationId,session.org_id,session.site_id])).rows[0];
    if(!row) throw new Error('Response unavailable');
    const acknowledgment=(await client.query('SELECT received_at FROM acknowledgments WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3',[assignmentId,session.org_id,session.site_id])).rows[0];
    const cases=(await client.query('SELECT id,status,reason FROM clarifications WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100',[assignmentId,session.org_id,session.site_id])).rows;
    const responseMode=snapshot.responseMode || 'question',deliveryMode=snapshot.deliveryMode || 'both';
    return {publication,assignment:{id:row.id,worker:row.worker,language:row.language,dueAt:row.due_at?.toISOString() || null},
      question:responseMode==='acknowledge'?null:snapshot.question,facts:snapshot.facts,
      workerQuestion:responseMode==='acknowledge'?null:snapshot.languages?.[row.language]?.question || null,
      responseMode,deliveryMode,
      ...(snapshot.rubric?.mode==='multiple-choice'?{questionType:'multiple-choice',choices:snapshot.languages?.[row.language]?.choices || snapshot.languages?.en?.choices}:{}),
      acknowledgedAt:acknowledgment?.received_at?.toISOString() || null,
      ...await submissionHistory(client,session,assignmentId,page,pageSize,true),cases};
  });
}
