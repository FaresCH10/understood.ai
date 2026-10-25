import {deletionInput,deletionFilters} from '../deletion-input.mjs';
import {applicationCleanupEvidence} from '../deletion-scope.mjs';
import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';

export async function listPrivacyWorkers(pool,session,filters={},{schema='public'}={}){
  const {page,pageSize,search,status}=deletionFilters(filters);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    const result=(await client.query(`WITH scoped AS (
      SELECT w.id,w.code,w.active,d.created_at AS requested_at,c.completed_at,
        CASE WHEN c.request_id IS NOT NULL THEN 'complete' WHEN d.id IS NOT NULL THEN 'queued' ELSE 'none' END AS deletion_status
      FROM workers w LEFT JOIN worker_deletion_requests d ON d.worker_id=w.id LEFT JOIN worker_deletion_completions c ON c.request_id=d.id
      WHERE w.org_id=$1 AND w.site_id=$2 AND ($3='' OR strpos(lower(w.code),lower($3))>0 OR strpos(lower(w.id),lower($3))>0)),
      filtered AS (SELECT * FROM scoped WHERE $4='all' OR deletion_status=$4)
      SELECT (SELECT count(*) FROM filtered) AS total,
        COALESCE((SELECT jsonb_agg(rows) FROM (SELECT * FROM filtered ORDER BY lower(code),id LIMIT $5 OFFSET $6) rows),'[]'::jsonb) AS items`,
      [session.org_id,session.site_id,search,status,pageSize,(page-1)*pageSize])).rows[0];
    return {items:result.items.map(row=>({...row,cleanupEvidence:applicationCleanupEvidence()})),total:Number(result.total),page,pageSize};
  });
}

export async function getWorkerDeletion(pool,session,workerId,{schema='public'}={}){
  if(typeof workerId!=='string' || !workerId || workerId.length>100)throw new Error('Invalid deletion request');
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    if(!(await client.query('SELECT 1 FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3',[workerId,session.org_id,session.site_id])).rows.length)throw new Error('Worker unavailable');
    const row=(await client.query(`SELECT d.id,d.worker_id,d.reason,d.created_at,rd.completed_at AS redacted_at,p.completed_at AS pseudonymized_at,c.completed_at
      FROM worker_deletion_requests d LEFT JOIN worker_deletion_redactions rd ON rd.request_id=d.id
      LEFT JOIN worker_deletion_pseudonyms p ON p.request_id=d.id LEFT JOIN worker_deletion_completions c ON c.request_id=d.id
      WHERE d.worker_id=$1 AND d.org_id=$2 AND d.site_id=$3`,[workerId,session.org_id,session.site_id])).rows[0];
    return row?{id:row.id,workerId:row.worker_id,reason:row.reason,createdAt:row.created_at,completedAt:row.completed_at,
      status:row.completed_at?'complete':'queued',contentRedactedAt:row.redacted_at,identityPseudonymizedAt:row.pseudonymized_at,cleanupEvidence:applicationCleanupEvidence()}:null;
  });
}

export async function requestWorkerDeletion(pool,session,workerId,input,{schema='public'}={}){
  const fingerprint=deletionInput(workerId,input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`deletion:${input.requestId}`]);
    const old=(await client.query('SELECT * FROM worker_deletion_requests WHERE id=$1',[input.requestId])).rows[0];
    if(old){
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.actor_id!==session.principal_id
        || old.worker_id!==workerId || old.fingerprint!==fingerprint)throw new Error('Deletion request conflict');
      return {id:old.id,status:(await client.query('SELECT 1 FROM worker_deletion_completions WHERE request_id=$1',[old.id])).rows.length?'complete':'queued',duplicate:true,cleanupEvidence:applicationCleanupEvidence()};
    }
    const worker=(await client.query('SELECT * FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[workerId,session.org_id,session.site_id])).rows[0];
    if(!worker)throw new Error('Worker unavailable');
    if(worker.code!==input.expectedCode)throw new Error('Worker code changed');
    if((await client.query('SELECT 1 FROM worker_deletion_requests WHERE worker_id=$1',[workerId])).rows.length)throw new Error('Worker deletion pending');
    await client.query('UPDATE workers SET active=false WHERE id=$1',[workerId]);
    await client.query('INSERT INTO worker_deletion_requests VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())',[input.requestId,session.org_id,session.site_id,workerId,session.principal_id,fingerprint,input.reason]);
    await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND revoked_at IS NULL',[workerId]);
    await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND revoked_at IS NULL',[workerId]);
    await client.query(`UPDATE push_subscriptions SET revoked_at=clock_timestamp(),revoke_reason='worker_deleted',updated_at=clock_timestamp()
      WHERE principal_type='worker' AND principal_id=$1 AND revoked_at IS NULL`,[workerId]);
    await client.query(`UPDATE push_deliveries SET state='cancelled',last_error='worker_deleted',updated_at=clock_timestamp()
      WHERE state IN ('queued','sending') AND subscription_id IN (SELECT id FROM push_subscriptions
        WHERE principal_type='worker' AND principal_id=$1)`,[workerId]);
    await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='worker' AND principal_id=$1 AND revoked_at IS NULL",[workerId]);
    await client.query(`UPDATE recordings SET status='failed',transcript=NULL,lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Worker deletion pending'
      WHERE status<>'storing' AND assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)`,[workerId]);
    await client.query(`UPDATE assessment_jobs SET status='blocked',lease_token=NULL,lease_until=NULL,error='Worker deletion pending'
      WHERE status<>'complete' AND assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)`,[workerId]);
    await domainAudit(client,session,'worker.deletion.requested',workerId);
    return {id:input.requestId,status:'queued',duplicate:false,cleanupEvidence:applicationCleanupEvidence()};
  });
}
