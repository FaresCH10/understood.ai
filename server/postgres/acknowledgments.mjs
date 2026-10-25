import {domainAudit,domainTransaction,requirePrincipal} from './domain.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';

const uuid=(value)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function acknowledgeAssignment(pool,session,assignmentId,requestId,{schema='public'}={}) {
  if(typeof assignmentId!=='string' || !assignmentId || assignmentId.length>100 || !uuid(requestId))
    throw new Error('Invalid acknowledgment request');
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'worker');
    const assignment=(await client.query(`SELECT a.id,a.due_at,p.state,p.snapshot_json FROM assignments a
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      WHERE a.id=$1 AND a.org_id=$2 AND a.site_id=$3 AND a.worker_id=$4 FOR UPDATE`,
    [assignmentId,session.org_id,session.site_id,session.principal_id])).rows[0];
    if(!assignment) throw new Error('Assignment unavailable');
    const old=(await client.query('SELECT request_id,received_at FROM acknowledgments WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3',
      [assignmentId,session.org_id,session.site_id])).rows[0];
    if(old) return {id:old.request_id,receivedAt:old.received_at.toISOString(),duplicate:true};
    await requireWritableEntitlement(client,session.org_id);
    if(assignment.snapshot_json?.responseMode!=='acknowledge') throw new Error('This instruction requires an answer');
    if(assignment.state!=='published') throw new Error('Assignment unavailable');
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    if(assignment.due_at && assignment.due_at<=now) throw new Error('Assignment deadline passed');
    await client.query(`INSERT INTO acknowledgments(request_id,org_id,site_id,assignment_id,worker_id,received_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(assignment_id) DO NOTHING`,
    [requestId,session.org_id,session.site_id,assignmentId,session.principal_id,now]);
    const saved=(await client.query('SELECT request_id,received_at FROM acknowledgments WHERE assignment_id=$1 AND org_id=$2 AND site_id=$3',
      [assignmentId,session.org_id,session.site_id])).rows[0];
    if(saved.request_id!==requestId) return {id:saved.request_id,receivedAt:saved.received_at.toISOString(),duplicate:true};
    await domainAudit(client,session,'instruction.acknowledged',assignmentId);
    return {id:requestId,receivedAt:saved.received_at.toISOString(),duplicate:false};
  });
}
