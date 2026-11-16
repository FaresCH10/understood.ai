import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {responseRead} from './responses.mjs';
import {textRetentionDays,textRetentionInput,textRetentionRequestId} from '../text-retention-input.mjs';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {staffRecoveryScope} from '../staff-input.mjs';

export function getCaseRetention(pool,session,{schema='public'}={}) {
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator','supervisor','auditor']);
    const policy=(await client.query('SELECT revision,days FROM case_retention_policies WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0];
    const count=(await client.query('SELECT count(*)::integer AS n FROM case_content_purges WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0].n;
    const scope=staffRecoveryScope(session);
    return {revision:policy?.revision ?? 0,days:policy?.days ?? null,canWrite:['owner','administrator'].includes(session.role),
      recoveryScope:scope?`case:${scope}`:null,options:textRetentionDays,completed:{case:count},
      limitations:'Scheduled cleanup redacts resolved case reasons, notes, help text, messages, follow-up source/translation and disagreement reasons after resolution and all later case activity expire. Open cases are preserved. Related voice objects are retired through retryable cleanup. Outcomes, receipt hashes and audit metadata remain; answers, briefing content, backups and device copies have separate lifecycles. Historical cases start their resolution clock when this policy capability is installed.'};
  });
}
export function caseRetentionReceipt(pool,session,requestId,{schema='public'}={}) {
  textRetentionRequestId(requestId);
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    const row=(await client.query('SELECT * FROM case_retention_requests WHERE id=$1 AND org_id=$2 AND site_id=$3 AND actor_id=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
    return row?{requestId:row.id,request:row.request_json,revision:row.revision}:null;
  });
}
export function saveCaseRetention(pool,session,input,{schema='public'}={}) {
  const value=textRetentionInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`case-retention:${input.requestId}`]);
    const old=(await client.query('SELECT * FROM case_retention_requests WHERE id=$1',[input.requestId])).rows[0];
    if(old){if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.actor_id!==session.principal_id || bundleHash(old.request_json)!==bundleHash(value))throw Error('Case retention request conflict');return {revision:old.revision,duplicate:true};}
    await client.query('SELECT id FROM sites WHERE id=$1 AND org_id=$2 FOR UPDATE',[session.site_id,session.org_id]);
    const oldPolicy=(await client.query('SELECT revision FROM case_retention_policies WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0];
    if((oldPolicy?.revision ?? 0)!==value.revision)throw Error('Case retention revision changed');
    const revision=value.revision+1;
    await client.query(`INSERT INTO case_retention_policies VALUES($1,$2,$3,$4,clock_timestamp()) ON CONFLICT(site_id)
      DO UPDATE SET revision=excluded.revision,days=excluded.days,updated_at=excluded.updated_at`,[session.site_id,session.org_id,revision,value.days]);
    await client.query('INSERT INTO case_retention_requests VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())',[input.requestId,session.org_id,session.site_id,session.principal_id,JSON.stringify(value),revision]);
    await domainAudit(client,session,'retention.case_policy.updated',session.site_id);return {revision,duplicate:false};
  });
}
export const caseContentRetentionDue=`c.status='resolved' AND c.resolved_at<=clock_timestamp()-p.days*interval '1 day'
  AND NOT EXISTS(SELECT 1 FROM case_content_purges d WHERE d.case_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM case_messages m WHERE m.case_id=c.id AND m.created_at>clock_timestamp()-p.days*interval '1 day')
  AND NOT EXISTS(SELECT 1 FROM case_followups f WHERE f.case_id=c.id AND GREATEST(f.created_at,f.delivered_at)>clock_timestamp()-p.days*interval '1 day')
  AND NOT EXISTS(SELECT 1 FROM clarification_exchanges e WHERE e.case_id=c.id AND GREATEST(e.created_at,e.delivered_at)>clock_timestamp()-p.days*interval '1 day')
  AND NOT EXISTS(SELECT 1 FROM case_reviews r WHERE r.case_id=c.id AND r.created_at>clock_timestamp()-p.days*interval '1 day')
  AND NOT EXISTS(SELECT 1 FROM case_voice v WHERE v.requested_case_id=c.id AND GREATEST(v.created_at,v.received_at)>clock_timestamp()-p.days*interval '1 day')`;
const due=caseContentRetentionDue;
export async function redactExpiredCase(client,caseId) {
  const deleted=(await client.query('SELECT 1 FROM worker_deletion_requests d JOIN assignments a ON a.worker_id=d.worker_id JOIN clarifications c ON c.assignment_id=a.id WHERE c.id=$1',[caseId])).rows.length;
  const marker=deleted?'[Deleted]':'[Expired]';
  await client.query("UPDATE clarifications SET reason=$2,notes='' WHERE id=$1",[caseId,marker]);
  await client.query('UPDATE help_requests SET text=$2 WHERE case_id=$1',[caseId,marker]);
  await client.query('UPDATE case_messages SET text=$2 WHERE case_id=$1',[caseId,marker]);
  await client.query("UPDATE clarification_exchanges SET source_text=$2,translated_text=NULL,state='failed',lease_token=NULL,lease_until=NULL,error_code='content_expired' WHERE case_id=$1",[caseId,marker]);
  await client.query("UPDATE case_reviews SET reason=$2 WHERE case_id=$1 AND kind='disagree'",[caseId,marker]);
  await client.query(`UPDATE case_followups SET source_text=$2,glossary_json='{}',manifest_json=NULL,status='failed',
    lease_token=NULL,lease_until=NULL,error_code='content_expired' WHERE case_id=$1`,[caseId,marker]);
}

export function processOneCaseContentPurge(pool,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    const policy=(await client.query(`SELECT p.* FROM case_retention_policies p WHERE p.days IS NOT NULL
      AND EXISTS(SELECT 1 FROM clarifications c WHERE c.org_id=p.org_id AND c.site_id=p.site_id AND ${due})
      ORDER BY p.updated_at,p.site_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`)).rows[0];
    if(!policy)return false;
    const candidate=(await client.query(`SELECT c.id,c.assignment_id,a.worker_id FROM clarifications c JOIN assignments a ON a.id=c.assignment_id
      JOIN case_retention_policies p ON p.org_id=c.org_id AND p.site_id=c.site_id
      WHERE c.org_id=$1 AND c.site_id=$2 AND ${due} ORDER BY c.resolved_at,c.id LIMIT 1`,[policy.org_id,policy.site_id])).rows[0];
    if(!candidate)return false;
    await client.query('SELECT id FROM workers WHERE id=$1 FOR SHARE',[candidate.worker_id]);
    await client.query('SELECT id FROM assignments WHERE id=$1 FOR UPDATE',[candidate.assignment_id]);
    const current=(await client.query(`SELECT c.id FROM clarifications c JOIN case_retention_policies p ON p.org_id=c.org_id AND p.site_id=c.site_id
      WHERE c.id=$1 AND ${due} FOR UPDATE OF c`,[candidate.id])).rows[0];
    if(!current)return false;
    await client.query('INSERT INTO case_content_purges(case_id,org_id,site_id,assignment_id,policy_revision,days) VALUES($1,$2,$3,$4,$5,$6)',
      [candidate.id,policy.org_id,policy.site_id,candidate.assignment_id,policy.revision,policy.days]);
    await redactExpiredCase(client,candidate.id);
    await domainAudit(client,{...policy,principal_type:'system',principal_id:'case-retention-worker'},'retention.case_content.purged',candidate.id);
    return true;
  });
}
