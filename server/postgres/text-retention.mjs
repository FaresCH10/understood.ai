import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {responseRead} from './responses.mjs';
import {textRetentionDays,textRetentionInput,textRetentionRequestId} from '../text-retention-input.mjs';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {staffRecoveryScope} from '../staff-input.mjs';

export function getTextRetention(pool,session,{schema='public'}={}) {
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator','supervisor','auditor']);
    const policy=(await client.query('SELECT revision,days,updated_at FROM text_retention_policies WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0];
    const purges=(await client.query('SELECT kind,count(*)::integer AS count FROM text_retention_purges WHERE org_id=$1 AND site_id=$2 GROUP BY kind',[session.org_id,session.site_id])).rows;
    return {revision:policy?.revision ?? 0,days:policy?.days ?? null,updatedAt:policy?.updated_at ?? null,options:textRetentionDays,
      canWrite:['owner','administrator'].includes(session.role),recoveryScope:staffRecoveryScope(session),completed:Object.fromEntries(purges.map(row=>[row.kind,row.count])),
      limitations:'Scheduled cleanup redacts worker answer text, assessment quotes, recording transcripts and translated answer-presentation copies, preserving outcomes and receipt/provenance hashes. Related stored report exports expire. Clarification messages/notes, briefing text, audio, audit metadata, backups and downloaded or disconnected device copies have separate lifecycles.'};
  });
}
export function textRetentionReceipt(pool,session,requestId,{schema='public'}={}) {
  textRetentionRequestId(requestId);
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    const row=(await client.query('SELECT * FROM text_retention_requests WHERE id=$1 AND org_id=$2 AND site_id=$3 AND actor_id=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
    return row?{requestId:row.id,request:row.request_json,revision:row.revision}:null;
  });
}
export function saveTextRetention(pool,session,input,{schema='public'}={}) {
  const value=textRetentionInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`text-retention:${input.requestId}`]);
    const old=(await client.query('SELECT * FROM text_retention_requests WHERE id=$1',[input.requestId])).rows[0];
    if(old) {
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.actor_id!==session.principal_id || bundleHash(old.request_json)!==bundleHash(value))throw Error('Text retention request conflict');
      return {revision:old.revision,duplicate:true};
    }
    await client.query('SELECT id FROM sites WHERE id=$1 AND org_id=$2 FOR UPDATE',[session.site_id,session.org_id]);
    const policy=(await client.query('SELECT revision FROM text_retention_policies WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0];
    if((policy?.revision ?? 0)!==value.revision)throw Error('Text retention revision changed');
    const revision=value.revision+1;
    await client.query(`INSERT INTO text_retention_policies(site_id,org_id,revision,days,updated_at) VALUES($1,$2,$3,$4,clock_timestamp())
      ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,days=excluded.days,updated_at=excluded.updated_at`,[session.site_id,session.org_id,revision,value.days]);
    await client.query('INSERT INTO text_retention_requests VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())',[input.requestId,session.org_id,session.site_id,session.principal_id,JSON.stringify(value),revision]);
    await domainAudit(client,session,'retention.text_policy.updated',session.site_id);
    return {revision,duplicate:false};
  });
}

export async function redactExpiredText(client,{kind,id,assignmentId,submissionId,publicationId,orgId,siteId}) {
  if(kind==='attempt') {
    await client.query("UPDATE assessment_jobs SET status='blocked',lease_token=NULL,lease_until=NULL,error='Response text retention expired' WHERE attempt_id=$1 AND status<>'complete'",[id]);
    const deleted=(await client.query('SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id WHERE a.id=$1',[assignmentId])).rows.length;
    await client.query("UPDATE attempts SET answer_text=$2,reasons_json='[]',evidence_json='[]' WHERE id=$1",[id,deleted?'[Deleted]':'[Expired]']);
    await client.query(`UPDATE presentation_artifacts SET status='failed',title=NULL,text=NULL,question=NULL,provider=NULL,live=NULL,
      error_code='Response text retention expired',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE assignment_id=$1 AND source_kind='answer' AND source_id=$2 AND status='pending'`,[assignmentId,submissionId]);
    await client.query(`UPDATE presentation_artifacts SET title=CASE WHEN title IS NULL THEN NULL ELSE '[Expired]' END,
      text='[Expired]',question=CASE WHEN question IS NULL THEN NULL ELSE '[Expired]' END,updated_at=clock_timestamp()
      WHERE assignment_id=$1 AND source_kind='answer' AND source_id=$2 AND status='ready'
        AND text NOT IN ('[Deleted]','[Expired]')`,[assignmentId,submissionId]);
  }else if(kind==='recording')await client.query("UPDATE recordings SET transcript=NULL,status='failed',lease_token=NULL,lease_until=NULL,retry_at=NULL,error='Recording text retention expired' WHERE id=$1",[id]);
  else throw Error('Invalid text retention kind');
  await client.query(`UPDATE report_exports SET status='expired',snapshot_json=NULL,csv=NULL,checksum=NULL,lease_token=NULL,lease_until=NULL,error=NULL
    WHERE publication_id=$1 AND org_id=$2 AND site_id=$3 AND status<>'expired'`,[publicationId,orgId,siteId]);
}

export async function processOneTextPurge(pool,{schema='public',kind='attempt'}={}) {
  if(!['attempt','recording'].includes(kind))throw Error('Invalid text retention kind');
  const table=kind==='attempt'?'attempts':'recordings';
  return domainTransaction(pool,schema,async client=>{
    // Lock policy first: a disable/extension cannot race a completed redaction.
    const policy=(await client.query(`SELECT p.* FROM text_retention_policies p WHERE p.days IS NOT NULL
      AND EXISTS(SELECT 1 FROM ${table} r WHERE r.org_id=p.org_id AND r.site_id=p.site_id
        AND r.received_at<=clock_timestamp()-p.days*interval '1 day'
        AND NOT EXISTS(SELECT 1 FROM text_retention_purges d WHERE d.kind=$1 AND d.reference_id=r.id))
      ORDER BY p.updated_at,p.site_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,[kind])).rows[0];
    if(!policy)return false;
    const candidate=(await client.query(`SELECT r.id,r.assignment_id,a.publication_id FROM ${table} r JOIN assignments a ON a.id=r.assignment_id
      AND a.org_id=r.org_id AND a.site_id=r.site_id WHERE r.org_id=$1 AND r.site_id=$2
      AND r.received_at<=clock_timestamp()-$3*interval '1 day'
      AND NOT EXISTS(SELECT 1 FROM text_retention_purges d WHERE d.kind=$4 AND d.reference_id=r.id)
      ORDER BY r.received_at,r.id LIMIT 1`,[policy.org_id,policy.site_id,policy.days,kind])).rows[0];
    if(!candidate)return false;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`report-retention:${policy.org_id}:${candidate.publication_id}`]);
    await client.query('SELECT w.id FROM workers w JOIN assignments a ON a.worker_id=w.id AND a.org_id=w.org_id AND a.site_id=w.site_id WHERE a.id=$1 FOR SHARE OF w',[candidate.assignment_id]);
    const assignment=(await client.query('SELECT id,publication_id FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[candidate.assignment_id,policy.org_id,policy.site_id])).rows[0];
    if(kind==='attempt')await client.query('SELECT id FROM assessment_jobs WHERE attempt_id=$1 FOR UPDATE',[candidate.id]);
    const row=(await client.query(`SELECT r.* FROM ${table} r WHERE r.id=$1 AND r.org_id=$2 AND r.site_id=$3 FOR UPDATE`,[candidate.id,policy.org_id,policy.site_id])).rows[0];
    await client.query('INSERT INTO text_retention_purges(kind,reference_id,org_id,site_id,assignment_id,policy_revision,days) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [kind,row.id,policy.org_id,policy.site_id,row.assignment_id,policy.revision,policy.days]);
    await redactExpiredText(client,{kind,id:row.id,assignmentId:row.assignment_id,submissionId:row.submission_id,publicationId:assignment.publication_id,orgId:policy.org_id,siteId:policy.site_id});
    await domainAudit(client,{...policy,principal_type:'system',principal_id:'retention-worker'},`retention.${kind}_text.purged`,row.id);
    return true;
  });
}
