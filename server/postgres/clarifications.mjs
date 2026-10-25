import { domainTransaction,requirePrincipal,domainAudit } from './domain.mjs';
import { helpInput,clarificationFilters,resolutionInput,ownerInput,workerHelpHistoryInput } from '../clarification-input.mjs';
import {responseRead} from './responses.mjs';
import {routeNewCase} from './case-routing.mjs';
import {caseDeadlineOverride} from './case-reviews.mjs';
import {clarificationActionCommand,clarificationActionId,clarificationCaseId,clarificationActionReceiptRow,exactClarificationAction} from '../clarification-action-input.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';

const roles=['owner','supervisor','auditor'];
const iso=(value) => value instanceof Date ? value.toISOString() : value;
const id=(value) => typeof value==='string' && value.length>0 && value.length<=100;
const caseQuery=`SELECT c.id,c.reason,c.status,c.notes,c.created_at,c.owner_staff_id,c.assignment_id,c.attempt_id,
  w.code AS worker,a.language,a.due_at,COALESCE(${caseDeadlineOverride},r.due_at) AS case_due_at,r.escalated_at,p.id AS publication_id,p.version,p.snapshot_json->>'title' AS title,
  s.name AS owner_name
  FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id AND a.site_id=c.site_id
  JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
  JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
  LEFT JOIN staff s ON s.id=c.owner_staff_id AND s.org_id=c.org_id AND s.site_id=c.site_id
  LEFT JOIN case_routing r ON r.case_id=c.id AND r.org_id=c.org_id AND r.site_id=c.site_id`;
const caseRow=(row) => ({...row,created_at:iso(row.created_at),due_at:iso(row.due_at),case_due_at:iso(row.case_due_at),escalated_at:iso(row.escalated_at)});

export async function requestHelp(pool,session,assignmentId,input,{schema='public'}={}) {
  const {text}=helpInput(assignmentId,input);
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'worker');
    const assignment=(await client.query(`SELECT id,publication_id FROM assignments
      WHERE id=$1 AND org_id=$2 AND site_id=$3 AND worker_id=$4 FOR UPDATE`,[assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if (!assignment) throw new Error('Assignment unavailable');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`help:${input.requestId}`]);
    const old=(await client.query(`SELECT h.org_id,h.site_id,h.assignment_id,h.text,c.status FROM help_requests h
      JOIN clarifications c ON c.id=h.case_id AND c.org_id=h.org_id AND c.site_id=h.site_id WHERE h.case_id=$1`,[input.requestId])).rows[0];
    if (old) {
      if (old.org_id!==session.org_id || old.site_id!==session.site_id || old.assignment_id!==assignmentId || old.text!==text) throw new Error('Help request conflict');
      return {id:input.requestId,status:old.status,duplicate:true};
    }
    await requireWritableEntitlement(client,session.org_id);
    // Help is independent of an answer and may be requested after a deadline, but not on withdrawn content.
    const publication=(await client.query('SELECT state,publication_content_available(id) AS content_available FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',[assignment.publication_id,session.org_id,session.site_id])).rows[0];
    if (publication?.state!=='published' || !publication.content_available) throw new Error('Assignment unavailable');
    if ((await client.query('SELECT id FROM clarifications WHERE id=$1',[input.requestId])).rows.length) throw new Error('Help request conflict');
    await client.query(`INSERT INTO clarifications(id,org_id,site_id,assignment_id,reason,status)
      VALUES($1,$2,$3,$4,'Help requested','open')`,[input.requestId,session.org_id,session.site_id,assignmentId]);
    await client.query('INSERT INTO help_requests(case_id,org_id,site_id,assignment_id,text) VALUES($1,$2,$3,$4,$5)',[input.requestId,session.org_id,session.site_id,assignmentId,text]);
    await routeNewCase(client,session.org_id,session.site_id,input.requestId);
    await domainAudit(client,session,'help.requested',input.requestId);
    return {id:input.requestId,status:'open',duplicate:false};
  });
}

export async function listClarifications(pool,session,filters={}, {schema='public'}={}) {
  const {search,status,owner,overdue,page,pageSize}=clarificationFilters(filters);
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',roles);
    const args=[session.org_id,session.site_id],where=['c.org_id=$1','c.site_id=$2'];
    const bind=(value) => {args.push(value); return `$${args.length}`;};
    if (status!=='all') where.push(`c.status=${bind(status)}`);
    if (owner==='unassigned') where.push('c.owner_staff_id IS NULL');
    else if (owner!=='all') where.push(`c.owner_staff_id=${bind(owner==='mine' ? session.principal_id : owner)}`);
    if (overdue==='true') where.push(`c.status='open' AND COALESCE(${caseDeadlineOverride},r.due_at,a.due_at)<clock_timestamp()`);
    if (overdue==='false') where.push(`(c.status='resolved' OR COALESCE(${caseDeadlineOverride},r.due_at,a.due_at) IS NULL OR COALESCE(${caseDeadlineOverride},r.due_at,a.due_at)>=clock_timestamp())`);
    if (search.trim()) where.push(`strpos(lower(w.code||' '||c.reason||' '||COALESCE(p.snapshot_json->>'title','')),lower(${bind(search.trim())}))>0`);
    const rows=(await client.query(`${caseQuery} WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT 5001`,args)).rows;
    if (rows.length>5000) throw new Error('Clarifications exceed limit; narrow filters');
    const ownerOptions=(await client.query(`SELECT s.id,s.name FROM staff s WHERE s.org_id=$1 AND s.site_id=$2
      AND ((s.active AND s.role IN ('owner','supervisor')) OR EXISTS(SELECT 1 FROM clarifications c WHERE c.owner_staff_id=s.id AND c.org_id=s.org_id AND c.site_id=s.site_id))
      ORDER BY s.name,s.id LIMIT 5001`,[session.org_id,session.site_id])).rows;
    if(ownerOptions.length>5000)throw Error('Clarification owners exceed limit');
    return {rows:rows.slice((page-1)*pageSize,page*pageSize).map(caseRow),total:rows.length,page,pageSize,ownerOptions};
  });
}

export async function getClarification(pool,session,caseId,{schema='public'}={}) {
  return responseRead(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff',roles);
    const row=(await client.query(`${caseQuery} WHERE c.id=$1 AND c.org_id=$2 AND c.site_id=$3`,[caseId,session.org_id,session.site_id])).rows[0];
    if (!row) throw new Error('Clarification unavailable');
    const snapshot=(await client.query('SELECT snapshot_json FROM publications WHERE id=$1 AND org_id=$2 AND site_id=$3',[row.publication_id,session.org_id,session.site_id])).rows[0].snapshot_json;
    const attempts=(await client.query(`SELECT t.id,t.answer_text,t.outcome,t.assessment_status,t.reasons_json,t.evidence_json,t.received_at,
      r.id AS recording_id FROM attempts t LEFT JOIN recordings r ON r.assignment_id=t.assignment_id AND r.org_id=t.org_id
      AND r.site_id=t.site_id AND r.submission_id=t.submission_id AND r.received_at IS NOT NULL
      WHERE t.assignment_id=$1 AND t.org_id=$2 AND t.site_id=$3 ORDER BY t.received_at DESC,t.id DESC LIMIT 100`,[row.assignment_id,session.org_id,session.site_id])).rows.map((attempt) => ({...attempt,received_at:iso(attempt.received_at)}));
    // The original attempt must not disappear when later attempts push it off the recent history page.
    const original=row.attempt_id ? (await client.query(`SELECT t.answer_text,t.outcome,t.reasons_json,t.evidence_json,t.assessment_status,r.id AS recording_id FROM attempts t
      LEFT JOIN recordings r ON r.assignment_id=t.assignment_id AND r.org_id=t.org_id AND r.site_id=t.site_id AND r.submission_id=t.submission_id AND r.received_at IS NOT NULL
      WHERE t.id=$1 AND t.assignment_id=$2 AND t.org_id=$3 AND t.site_id=$4`,[row.attempt_id,row.assignment_id,session.org_id,session.site_id])).rows[0] : null;
    const help=(await client.query('SELECT text,created_at FROM help_requests WHERE case_id=$1 AND org_id=$2 AND site_id=$3',[caseId,session.org_id,session.site_id])).rows[0];
    const owners=(await client.query("SELECT id,name FROM staff WHERE org_id=$1 AND site_id=$2 AND active=true AND role IN ('owner','supervisor') ORDER BY name,id LIMIT 5001",[session.org_id,session.site_id])).rows;
    if(owners.length>5000)throw Error('Clarification owners exceed limit');
    const contentExpired=(await client.query('SELECT 1 FROM case_content_purges WHERE case_id=$1 AND org_id=$2 AND site_id=$3',[caseId,session.org_id,session.site_id])).rows.length>0;
    const creation=(await client.query(`SELECT cr.actor_id,s.name AS actor_name,cr.created_at FROM clarification_creations cr JOIN staff s ON s.id=cr.actor_id AND s.org_id=cr.org_id AND s.site_id=cr.site_id WHERE cr.case_id=$1 AND cr.org_id=$2 AND cr.site_id=$3`,[caseId,session.org_id,session.site_id])).rows[0];
    return {...caseRow(row),...original,...(creation?{staffCreation:{actorId:creation.actor_id,actorName:creation.actor_name,createdAt:iso(creation.created_at)}}:{}),snapshot,attempts,owners,contentExpired,canRequestRepeat:true,canReview:true,helpRequest:help ? {text:help.text,createdAt:iso(help.created_at)} : null};
  });
}

export async function workerHelpHistory(pool,session,assignmentId,input={}, {schema='public'}={}) {
  const {page,pageSize}=workerHelpHistoryInput(assignmentId,input);
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    const assignment=(await client.query(`SELECT a.id,a.language,p.version,p.state FROM assignments a JOIN publications p
      ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4`,[assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if(!assignment)throw new Error('Assignment unavailable');
    const total=(await client.query('SELECT COUNT(*)::int AS n FROM clarifications WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3',[assignmentId,session.org_id,session.site_id])).rows[0].n;
    const rows=(await client.query(`SELECT c.id,c.status,c.created_at,h.text AS help_text,s.name AS owner
      FROM clarifications c LEFT JOIN help_requests h ON h.case_id=c.id AND h.org_id=c.org_id AND h.site_id=c.site_id
      LEFT JOIN staff s ON s.id=c.owner_staff_id AND s.org_id=c.org_id AND s.site_id=c.site_id
      WHERE c.assignment_id=$1 AND c.org_id=$2 AND c.site_id=$3 ORDER BY c.created_at DESC,c.id DESC LIMIT $4 OFFSET $5`,[assignmentId,session.org_id,session.site_id,pageSize,(page-1)*pageSize])).rows;
    return {assignment,cases:rows.map(row=>({id:row.id,status:row.status,createdAt:iso(row.created_at),helpText:row.help_text,owner:row.owner})),total,page,pageSize};
  });
}

export async function workerHelpCases(pool,session,assignmentId,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'worker');
    if (!(await client.query('SELECT id FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3 AND worker_id=$4',[assignmentId,session.org_id,session.site_id,session.principal_id])).rows.length) throw new Error('Assignment unavailable');
    const rows=(await client.query(`SELECT c.id,c.status,c.created_at,h.text AS help_text,s.name AS owner
      FROM clarifications c LEFT JOIN help_requests h ON h.case_id=c.id AND h.org_id=c.org_id AND h.site_id=c.site_id
      LEFT JOIN staff s ON s.id=c.owner_staff_id AND s.org_id=c.org_id AND s.site_id=c.site_id
      WHERE c.assignment_id=$1 AND c.org_id=$2 AND c.site_id=$3 ORDER BY c.created_at DESC,c.id DESC LIMIT 100`,[assignmentId,session.org_id,session.site_id])).rows;
    return rows.map((row) => ({id:row.id,status:row.status,createdAt:iso(row.created_at),helpText:row.help_text,owner:row.owner}));
  });
}

async function lockCase(client,session,caseId) {
  if (!id(caseId)) throw new Error('Clarification unavailable');
  const row=(await client.query('SELECT id,status,notes,owner_staff_id FROM clarifications WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[caseId,session.org_id,session.site_id])).rows[0];
  if (!row) throw new Error('Clarification unavailable');
  return row;
}

export async function resolveClarification(pool,session,caseId,input,{schema='public'}={}) {
  const command=clarificationActionCommand('resolve',input),notes=resolutionInput(command?{notes:command.content.notes}:input);
  if(command&&!clarificationCaseId(caseId))throw Error('Invalid clarification action');
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    if(command){const old=await previousAction(client,session,caseId,command);if(old)return old;await requireSiteOperational(client,session.org_id,session.site_id);}
    const row=await lockCase(client,session,caseId);
    if (row.status==='resolved') {
      if(command)return recordAction(client,session,row,command,row.notes===notes?'unchanged':'rejected',row.notes===notes?null:'resolution_conflict');
      if (row.notes!==notes) throw new Error('Resolution conflict');
      return {id:caseId,status:'resolved',duplicate:true};
    }
    await client.query("UPDATE clarifications SET status='resolved',notes=$1 WHERE id=$2 AND org_id=$3 AND site_id=$4",[notes,caseId,session.org_id,session.site_id]);
    await domainAudit(client,session,'clarification.resolved',caseId);
    return command?recordAction(client,session,{...row,status:'resolved'},command,'applied'):{id:caseId,status:'resolved',duplicate:false};
  });
}

export async function assignClarification(pool,session,caseId,input,{schema='public'}={}) {
  const command=clarificationActionCommand('assign',input),content=command?{ownerId:command.content.ownerId}:input;
  ownerInput(content);if(command&&!clarificationCaseId(caseId))throw Error('Invalid clarification action');
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    if(command){
      const old=await previousAction(client,session,caseId,command);if(old)return old;
      await requireSiteOperational(client,session.org_id,session.site_id);
      const eligible=content.ownerId===null||(await client.query("SELECT id FROM staff WHERE id=$1 AND org_id=$2 AND site_id=$3 AND role IN ('owner','supervisor') AND active=true FOR SHARE",[content.ownerId,session.org_id,session.site_id])).rows.length>0;
      const row=await lockCase(client,session,caseId);
      if(row.owner_staff_id===content.ownerId)return recordAction(client,session,row,command,'unchanged');
      if(row.status==='resolved')return recordAction(client,session,row,command,'rejected','case_resolved');
      if(row.owner_staff_id!==command.content.expectedOwnerId)return recordAction(client,session,row,command,'rejected','owner_changed');
      if(!eligible)return recordAction(client,session,row,command,'rejected','owner_unavailable');
      await client.query('UPDATE clarifications SET owner_staff_id=$1 WHERE id=$2 AND org_id=$3 AND site_id=$4',[content.ownerId,caseId,session.org_id,session.site_id]);
      await client.query('UPDATE case_routing SET manual=true WHERE case_id=$1',[caseId]);
      await domainAudit(client,session,'clarification.assigned',caseId);
      return recordAction(client,session,{...row,owner_staff_id:content.ownerId},command,'applied');
    }
    // Principal locks precede case locks in every write, including staff revocation.
    if (input.ownerId!==null && !(await client.query(`SELECT id FROM staff WHERE id=$1 AND org_id=$2 AND site_id=$3
      AND role IN ('owner','supervisor') AND active=true FOR SHARE`,[input.ownerId,session.org_id,session.site_id])).rows.length) throw new Error('Clarification owner unavailable');
    const row=await lockCase(client,session,caseId);
    if (row.owner_staff_id===input.ownerId) return {id:caseId,ownerId:input.ownerId,duplicate:true};
    if (row.status==='resolved') throw new Error('Resolution conflict');
    await client.query('UPDATE clarifications SET owner_staff_id=$1 WHERE id=$2 AND org_id=$3 AND site_id=$4',[input.ownerId,caseId,session.org_id,session.site_id]);
    await client.query('UPDATE case_routing SET manual=true WHERE case_id=$1',[caseId]);
    await domainAudit(client,session,'clarification.assigned',caseId);
    return {id:caseId,ownerId:input.ownerId,duplicate:false};
  });
}

async function previousAction(client,session,caseId,command){
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`clarification-action:${command.id}`]);
  const row=(await client.query('SELECT * FROM clarification_action_receipts WHERE request_id=$1',[command.id])).rows[0];
  return row?exactClarificationAction(row,session,caseId,command):null;
}
async function recordAction(client,session,row,command,effect,reasonCode=null){
  const saved=(await client.query(`INSERT INTO clarification_action_receipts(request_id,org_id,site_id,case_id,actor_id,actor_role,kind,request_hash,effect,result_status,result_owner_id,reason_code)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[command.id,session.org_id,session.site_id,row.id,session.principal_id,session.role,command.kind,command.hash,effect,row.status,row.owner_staff_id,reasonCode])).rows[0];
  await domainAudit(client,session,'clarification.action_received',command.id);return clarificationActionReceiptRow(saved);
}
export function clarificationActionReceipt(pool,session,caseId,requestId,{schema='public'}={}){
  if(!clarificationCaseId(caseId)||!clarificationActionId(requestId))throw Error('Invalid clarification action');
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',roles);
    if(!(await client.query('SELECT 1 FROM clarifications WHERE id=$1 AND org_id=$2 AND site_id=$3',[caseId,session.org_id,session.site_id])).rows.length)throw Error('Clarification unavailable');
    return exactClarificationAction((await client.query('SELECT * FROM clarification_action_receipts WHERE request_id=$1',[requestId])).rows[0],session,caseId);
  });
}
