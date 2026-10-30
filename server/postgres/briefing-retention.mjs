import {domainTransaction,domainAudit,requirePrincipal} from './domain.mjs';
import {responseRead} from './responses.mjs';
import {textRetentionDays,textRetentionInput,textRetentionRequestId} from '../text-retention-input.mjs';
import {bundleHash} from '../ai/prepared-bundle.mjs';
import {staffRecoveryScope} from '../staff-input.mjs';

export const briefingContentRetentionDue=`briefing_content_due(b.id,b.org_id,b.site_id,p.days)`;
export function getBriefingRetention(pool,session,{schema='public'}={}) {
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator','supervisor','auditor']);
    const policy=(await client.query('SELECT revision,days FROM briefing_retention_policies WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0];
    const completed=(await client.query('SELECT count(*)::integer AS briefing FROM briefing_content_purges WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0];
    const scope=staffRecoveryScope(session);
    return {revision:policy?.revision ?? 0,days:policy?.days ?? null,canWrite:['owner','administrator'].includes(session.role),
      recoveryScope:scope?`briefing:${scope}`:null,options:textRetentionDays,completed,
      limitations:'Archived briefing content expires after the archive, last answer and case resolution have all aged past the policy. Active briefings, pending checks and open cases are not purged. Generated audio must finish its separate cleanup first. Source/title, prepared content, publication snapshots, review receipts, regeneration baselines, cleaned manifests, translated presentation copies and presented-question provenance are redacted; version identities, audiences, outcomes and content hashes remain. Independently created copies, case content, templates/glossary, operational notes, backups and downloaded/device copies have separate lifecycles. Disabling cleanup cannot restore content.'};
  });
}
export function briefingRetentionReceipt(pool,session,requestId,{schema='public'}={}) {
  textRetentionRequestId(requestId);
  return responseRead(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    const row=(await client.query('SELECT * FROM briefing_retention_requests WHERE id=$1 AND org_id=$2 AND site_id=$3 AND actor_id=$4',[requestId,session.org_id,session.site_id,session.principal_id])).rows[0];
    return row?{requestId:row.id,request:row.request_json,revision:row.revision}:null;
  });
}
export function saveBriefingRetention(pool,session,input,{schema='public'}={}) {
  const value=textRetentionInput(input);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff',['owner','administrator']);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`briefing-retention:${input.requestId}`]);
    const old=(await client.query('SELECT * FROM briefing_retention_requests WHERE id=$1',[input.requestId])).rows[0];
    if(old){if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.actor_id!==session.principal_id || bundleHash(old.request_json)!==bundleHash(value))throw Error('Briefing retention request conflict');return {revision:old.revision,duplicate:true};}
    await client.query('SELECT id FROM sites WHERE id=$1 AND org_id=$2 FOR UPDATE',[session.site_id,session.org_id]);
    const current=(await client.query('SELECT revision FROM briefing_retention_policies WHERE org_id=$1 AND site_id=$2',[session.org_id,session.site_id])).rows[0];
    if((current?.revision ?? 0)!==value.revision)throw Error('Briefing retention revision changed');
    const revision=value.revision+1;
    await client.query(`INSERT INTO briefing_retention_policies VALUES($1,$2,$3,$4,clock_timestamp()) ON CONFLICT(site_id)
      DO UPDATE SET revision=excluded.revision,days=excluded.days,updated_at=excluded.updated_at`,[session.site_id,session.org_id,revision,value.days]);
    await client.query('INSERT INTO briefing_retention_requests VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())',[input.requestId,session.org_id,session.site_id,session.principal_id,JSON.stringify(value),revision]);
    await domainAudit(client,session,'retention.briefing_policy.updated',session.site_id);return {revision,duplicate:false};
  });
}
export function processOneBriefingContentPurge(pool,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    const policy=(await client.query(`SELECT p.* FROM briefing_retention_policies p WHERE p.days IS NOT NULL
      AND EXISTS(SELECT 1 FROM briefings b WHERE b.org_id=p.org_id AND b.site_id=p.site_id AND ${briefingContentRetentionDue})
      ORDER BY p.updated_at,p.site_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`)).rows[0];
    if(!policy)return false;
    const row=(await client.query(`SELECT b.id FROM briefings b JOIN briefing_retention_policies p ON p.org_id=b.org_id AND p.site_id=b.site_id
      WHERE b.org_id=$1 AND b.site_id=$2 AND ${briefingContentRetentionDue} ORDER BY b.id LIMIT 1 FOR UPDATE OF b SKIP LOCKED`,[policy.org_id,policy.site_id])).rows[0];
    if(!row)return false;
    // Archive admission and preparation claims share the briefing lock. Lock the remaining
    // accepted evidence before the final due check and immutable physical-redaction receipt.
    await client.query('SELECT id FROM publications WHERE briefing_id=$1 ORDER BY id FOR UPDATE',[row.id]);
    await client.query('SELECT a.id FROM assignments a JOIN publications p ON p.id=a.publication_id WHERE p.briefing_id=$1 ORDER BY a.id FOR UPDATE OF a',[row.id]);
    await client.query('SELECT c.id FROM clarifications c JOIN assignments a ON a.id=c.assignment_id JOIN publications p ON p.id=a.publication_id WHERE p.briefing_id=$1 ORDER BY c.id FOR UPDATE OF c',[row.id]);
    await client.query('SELECT id FROM generated_bundles WHERE briefing_id=$1 ORDER BY id FOR UPDATE',[row.id]);
    const due=(await client.query('SELECT briefing_content_due($1,$2,$3,$4) AS due',[row.id,policy.org_id,policy.site_id,policy.days])).rows[0].due;
    if(!due)return false;
    await client.query(`INSERT INTO briefing_content_purges(briefing_id,org_id,site_id,policy_revision,days,proofs_json)
      VALUES($1,$2,$3,$4,$5,briefing_content_proofs($1,$2,$3))`,[row.id,policy.org_id,policy.site_id,policy.revision,policy.days]);
    await redactExpiredBriefingContent(client,row.id);
    await domainAudit(client,{...policy,principal_type:'system',principal_id:'briefing-retention-worker'},'retention.briefing_content.purged',row.id);
    return true;
  });
}

export async function redactExpiredBriefingContent(client,id) {
  await client.query("UPDATE briefings SET title='[Expired]',source='[Expired]',prepared_json=NULL WHERE id=$1",[id]);
  await client.query("UPDATE publications SET snapshot_json=briefing_content_tombstone('publications')->'snapshot_json' WHERE briefing_id=$1",[id]);
  await client.query("UPDATE draft_reviews SET content_json='{}' WHERE briefing_id=$1",[id]);
  await client.query("UPDATE briefing_review_requests SET request_json='{}' WHERE briefing_id=$1",[id]);
  await client.query('UPDATE briefing_regeneration_requests SET baseline_review_json=NULL WHERE briefing_id=$1',[id]);
  await client.query("UPDATE generated_bundles SET manifest_json='{}' WHERE briefing_id=$1",[id]);
  await client.query("UPDATE briefing_copies SET title='[Expired]' WHERE copy_briefing_id=$1",[id]);
  await client.query("UPDATE source_audio_requests SET title='[Expired]' WHERE briefing_id=$1",[id]);
  if((await client.query("SELECT to_regclass('instruction_attachments') IS NOT NULL AS present")).rows[0].present){
    await client.query('DELETE FROM instruction_attachments WHERE request_id IN (SELECT request_id FROM instruction_sends WHERE briefing_id=$1)',[id]);
    await client.query('DELETE FROM instruction_compositions WHERE id IN (SELECT request_id FROM instruction_sends WHERE briefing_id=$1)',[id]);
  }
  const sends=(await client.query(`SELECT to_regclass('instruction_sends') IS NOT NULL
    AND to_regclass('instruction_deliveries') IS NOT NULL
    AND to_regprocedure('instruction_send_request_tombstone(jsonb)') IS NOT NULL AS present`)).rows[0].present;
  if(sends){
    await client.query(`UPDATE instruction_sends SET request_json=instruction_send_request_tombstone(request_json)
      WHERE briefing_id=$1 AND request_json IS DISTINCT FROM instruction_send_request_tombstone(request_json)`,[id]);
    await client.query(`UPDATE instruction_deliveries SET state='blocked',reason='content_expired',updated_at=clock_timestamp()
      WHERE state='preparing' AND request_id IN (SELECT request_id FROM instruction_sends WHERE briefing_id=$1)`,[id]);
    await client.query(`UPDATE instruction_deliveries SET content_json=NULL,updated_at=clock_timestamp()
      WHERE content_json IS NOT NULL AND request_id IN (SELECT request_id FROM instruction_sends WHERE briefing_id=$1)`,[id]);
    await client.query(`UPDATE instruction_sends s SET undelivered_json=COALESCE((
        SELECT jsonb_agg(jsonb_build_object('reason',g.reason,'language',g.language,'count',g.n) ORDER BY g.first_worker)
        FROM (SELECT d.reason,d.language,count(*)::integer AS n,min(d.worker_id) AS first_worker
          FROM instruction_deliveries d WHERE d.request_id=s.request_id AND d.state<>'available' AND d.reason IS NOT NULL
          GROUP BY d.reason,d.language) g),'[]'::jsonb),updated_at=clock_timestamp()
      WHERE s.briefing_id=$1 AND EXISTS(SELECT 1 FROM instruction_deliveries d
        WHERE d.request_id=s.request_id AND d.reason='content_expired')`,[id]);
  }
  const presentations=(await client.query(`SELECT to_regclass('presentation_artifacts') IS NOT NULL
    AND to_regclass('answer_presentation_bindings') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('recordings') AND attname='presented_question' AND NOT attisdropped) AS present`)).rows[0].present;
  if(presentations){
    await client.query(`UPDATE presentation_artifacts p SET title=CASE WHEN p.title IS NULL THEN NULL ELSE '[Expired]' END,
      text='[Expired]',question=CASE WHEN p.question IS NULL THEN NULL ELSE '[Expired]' END,updated_at=clock_timestamp()
      WHERE p.assignment_id IN (SELECT a.id FROM assignments a JOIN publications pub ON pub.id=a.publication_id WHERE pub.briefing_id=$1)
        AND p.status='ready' AND p.text NOT IN ('[Deleted]','[Expired]')`,[id]);
    await client.query(`UPDATE presentation_artifacts p SET status='failed',title=NULL,text=NULL,question=NULL,provider=NULL,live=NULL,
      error_code='Briefing content retention expired',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE p.assignment_id IN (SELECT a.id FROM assignments a JOIN publications pub ON pub.id=a.publication_id WHERE pub.briefing_id=$1)
        AND p.status='pending'`,[id]);
    await client.query(`UPDATE answer_presentation_bindings SET presented_question='[Expired]'
      WHERE presentation_id IN (SELECT p.id FROM presentation_artifacts p JOIN assignments a ON a.id=p.assignment_id
        JOIN publications pub ON pub.id=a.publication_id WHERE pub.briefing_id=$1)
        AND presented_question NOT IN ('[Deleted]','[Expired]')`,[id]);
    await client.query(`UPDATE recordings SET presented_question='[Expired]'
      WHERE assignment_id IN (SELECT a.id FROM assignments a JOIN publications pub ON pub.id=a.publication_id WHERE pub.briefing_id=$1)
        AND presented_question IS NOT NULL AND presented_question NOT IN ('[Deleted]','[Expired]')`,[id]);
  }
}

export async function expiredBriefingContentMatches(client,briefingId,kind,key,content) {
  return (await client.query(`SELECT proofs_json->$2->>$3=encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex') AS matched
    FROM briefing_content_purges WHERE briefing_id=$1`,[briefingId,kind,key,JSON.stringify(content)])).rows[0]?.matched===true;
}
