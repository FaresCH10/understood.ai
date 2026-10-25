import {domainTransaction,requirePrincipal,domainAudit} from './domain.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {recordWorkerEvent} from './notification-events.mjs';

const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const iso=value=>value instanceof Date?value.toISOString():value;
export const repeatRow=row=>({id:row.id,caseId:row.case_id,status:row.status,dueAt:iso(row.due_at),createdAt:iso(row.created_at),submittedAt:iso(row.submitted_at)});
export const pendingRepeatPredicate=`EXISTS(SELECT 1 FROM case_repeats cr JOIN clarifications cc ON cc.id=cr.case_id AND cc.org_id=cr.org_id AND cc.site_id=cr.site_id
  WHERE cr.assignment_id=a.id AND cr.org_id=a.org_id AND cr.site_id=a.site_id AND cr.status='pending' AND cr.due_at>clock_timestamp() AND cc.status='open')`;
export const pendingRepeatColumns=`(SELECT jsonb_build_object('id',cr.id,'caseId',cr.case_id,'dueAt',cr.due_at) FROM case_repeats cr
  JOIN clarifications cc ON cc.id=cr.case_id AND cc.org_id=cr.org_id AND cc.site_id=cr.site_id
  WHERE cr.assignment_id=a.id AND cr.org_id=a.org_id AND cr.site_id=a.site_id AND cr.status='pending' AND cr.due_at>clock_timestamp()
    AND cc.status='open' AND p.state='published') AS repeat_request`;

async function repeatCase(client,session,caseId,write=false) {
  await requirePrincipal(client,session,'staff',write?['owner','supervisor']:['owner','supervisor','auditor']);
  if(write)await requireSiteOperational(client,session.org_id,session.site_id);
  // Match submission/deletion lock order: worker, assignment, then case.
  const identity=(await client.query(`SELECT a.worker_id,a.id FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id AND a.site_id=c.site_id
    WHERE c.id=$1 AND c.org_id=$2 AND c.site_id=$3`,[caseId,session.org_id,session.site_id])).rows[0];
  if(!identity)throw Error('Clarification unavailable');
  const worker=(await client.query('SELECT active FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[identity.worker_id,session.org_id,session.site_id])).rows[0];
  const assignment=(await client.query('SELECT id,publication_id FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[identity.id,session.org_id,session.site_id])).rows[0];
  const row=(await client.query('SELECT id,status FROM clarifications WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[caseId,session.org_id,session.site_id])).rows[0];
  return {...row,worker_id:identity.worker_id,assignment_id:assignment.id,publication_id:assignment.publication_id,active:worker?.active};
}
export function listCaseRepeats(pool,session,caseId,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    await repeatCase(client,session,caseId);
    return (await client.query('SELECT * FROM case_repeats WHERE case_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY created_at DESC,id DESC LIMIT 100',[caseId,session.org_id,session.site_id])).rows.map(repeatRow);
  });
}
export async function caseRepeatReceipt(pool,session,caseId,requestId,{schema='public'}={}) {
  if(!uuid(requestId))throw Error('Invalid repeat request');
  return domainTransaction(pool,schema,async client=>{
    await repeatCase(client,session,caseId);
    const row=(await client.query('SELECT * FROM case_repeats WHERE id=$1 AND case_id=$2 AND org_id=$3 AND site_id=$4 AND actor_id=$5 AND actor_role=$6',[requestId,caseId,session.org_id,session.site_id,session.principal_id,session.role])).rows[0];
    if(!row)throw Error('Repeat receipt unavailable');return repeatRow(row);
  });
}
export async function requestCaseRepeat(pool,session,caseId,input,{schema='public'}={}) {
  if(!input || Object.keys(input).sort().join(',')!=='dueAt,requestId' || !uuid(input.requestId)
    || typeof input.dueAt!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.dueAt) || !Number.isFinite(Date.parse(input.dueAt))
    || new Date(input.dueAt).toISOString()!==input.dueAt)throw Error('Invalid repeat request');
  return domainTransaction(pool,schema,async client=>{
    const thread=await repeatCase(client,session,caseId,true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`case-repeat:${input.requestId}`]);
    const old=(await client.query('SELECT * FROM case_repeats WHERE id=$1',[input.requestId])).rows[0];
    if(old) {
      if(old.case_id!==caseId || old.org_id!==session.org_id || old.site_id!==session.site_id || old.actor_id!==session.principal_id || old.actor_role!==session.role
        || iso(old.due_at)!==input.dueAt)throw Error('Repeat request conflict');return repeatRow(old);
    }
    await requireWritableEntitlement(client,session.org_id);
    const publication=(await client.query('SELECT state,publication_content_available(id) AS content_available FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[thread.publication_id,session.org_id,session.site_id])).rows[0];
    if(thread.status!=='open' || !thread.active || publication?.state!=='published' || !publication.content_available)throw Error('Repeat request unavailable');
    if(!(await client.query("SELECT $1::timestamptz>clock_timestamp() AND $1::timestamptz<=clock_timestamp()+interval '30 days' AS valid",[input.dueAt])).rows[0].valid)throw Error('Invalid repeat deadline');
    if(!(await client.query('SELECT 1 FROM submission_receipts WHERE assignment_id=$1 AND org_id=$2 LIMIT 1',[thread.assignment_id,session.org_id])).rows.length)throw Error('Repeat requires an earlier answer');
    await client.query(`UPDATE case_repeats cr SET status=CASE WHEN cr.due_at<=clock_timestamp() THEN 'expired' ELSE 'cancelled' END
      WHERE cr.assignment_id=$1 AND cr.status='pending' AND (cr.due_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM clarifications cc WHERE cc.id=cr.case_id AND cc.status='resolved'))`,[thread.assignment_id]);
    if((await client.query("SELECT 1 FROM case_repeats WHERE assignment_id=$1 AND status='pending'",[thread.assignment_id])).rows.length)throw Error('Repeat already requested');
    const row=(await client.query(`INSERT INTO case_repeats(id,org_id,site_id,case_id,assignment_id,publication_id,actor_id,actor_role,due_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[input.requestId,session.org_id,session.site_id,caseId,thread.assignment_id,thread.publication_id,session.principal_id,session.role,input.dueAt])).rows[0];
    await domainAudit(client,session,'clarification.repeat_requested',row.id);
    await recordWorkerEvent(client,{orgId:session.org_id,siteId:session.site_id,workerId:thread.worker_id,
      kind:'repeat.available',objectType:'case_repeat',objectId:row.id,dedupeKey:`repeat.available:${row.id}`});
    return repeatRow(row);  });
}

// Caller holds the worker and assignment locks through receipt acceptance.
export async function acceptingRepeat(client,session,assignment) {
  const row=(await client.query(`SELECT cr.id FROM case_repeats cr JOIN clarifications c ON c.id=cr.case_id AND c.org_id=cr.org_id AND c.site_id=cr.site_id
    WHERE cr.assignment_id=$1 AND cr.org_id=$2 AND cr.site_id=$3 AND cr.publication_id=$4 AND cr.status='pending'
      AND cr.due_at>clock_timestamp() AND c.status='open' FOR UPDATE OF cr FOR SHARE OF c`,[assignment.id,session.org_id,session.site_id,assignment.publication_id])).rows[0];
  if(row)return row.id;
  if(assignment.due_at && !(await client.query('SELECT $1::timestamptz>clock_timestamp() AS valid',[assignment.due_at])).rows[0].valid)throw Error('Assignment deadline passed');
  return null;
}
export async function consumeRepeat(client,id,submissionId,receivedAt) {
  if(id)await client.query("UPDATE case_repeats SET status='submitted',submission_id=$2,submitted_at=$3 WHERE id=$1 AND status='pending'",[id,submissionId,receivedAt]);
}
