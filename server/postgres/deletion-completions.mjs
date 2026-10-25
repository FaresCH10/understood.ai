import {domainTransaction,domainAudit} from './domain.mjs';
import {deletionSnapshotsClear} from '../deletion-verification.mjs';

const candidate=`SELECT d.*,p.code_hash FROM worker_deletion_requests d JOIN worker_deletion_pseudonyms p ON p.request_id=d.id
  JOIN worker_deletion_redactions rd ON rd.request_id=d.id JOIN workers w ON w.id=d.worker_id AND NOT w.active AND w.code=p.pseudonym
  WHERE NOT EXISTS(SELECT 1 FROM worker_deletion_completions c WHERE c.request_id=d.id)
  AND NOT EXISTS(SELECT 1 FROM worker_grants g WHERE g.worker_id=d.worker_id AND g.revoked_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.principal_type='worker' AND s.principal_id=d.worker_id AND s.revoked_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM crew_memberships cm WHERE cm.worker_id=d.worker_id)
  AND NOT EXISTS(SELECT 1 FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=d.worker_id
    AND (rec.status<>'failed' OR rec.transcript IS NOT NULL OR rec.lease_token IS NOT NULL OR rec.lease_until IS NOT NULL OR rec.retry_at IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM recording_purges pur WHERE pur.recording_id=rec.id AND pur.status='complete')))
  AND NOT EXISTS(SELECT 1 FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=d.worker_id
    AND rec.presented_question IS NOT NULL AND rec.presented_question<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM assessment_jobs j JOIN assignments a ON a.id=j.assignment_id WHERE a.worker_id=d.worker_id
    AND (j.status NOT IN ('complete','blocked') OR j.lease_token IS NOT NULL OR j.lease_until IS NOT NULL))
  AND NOT EXISTS(SELECT 1 FROM attempts t JOIN assignments a ON a.id=t.assignment_id WHERE a.worker_id=d.worker_id
    AND (t.answer_text<>'[Deleted]' OR t.reasons_json<>'[]'::jsonb OR t.evidence_json<>'[]'::jsonb))
  AND NOT EXISTS(SELECT 1 FROM help_requests h JOIN assignments a ON a.id=h.assignment_id WHERE a.worker_id=d.worker_id AND h.text<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM case_messages m JOIN assignments a ON a.id=m.assignment_id WHERE a.worker_id=d.worker_id AND m.text<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM case_reviews v JOIN assignments a ON a.id=v.assignment_id WHERE a.worker_id=d.worker_id AND v.kind='disagree' AND v.reason<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM case_voice v WHERE v.worker_id=d.worker_id AND v.cleanup_state<>'cleaned')
  AND NOT EXISTS(SELECT 1 FROM case_followups f JOIN assignments a ON a.id=f.assignment_id WHERE a.worker_id=d.worker_id
    AND (f.source_text<>'[Deleted]' OR f.glossary_json<>'{}'::jsonb OR f.manifest_json IS NOT NULL OR f.status<>'failed' OR f.lease_token IS NOT NULL OR f.lease_until IS NOT NULL))
  AND NOT EXISTS(SELECT 1 FROM case_followup_audio au JOIN case_followups f ON f.id=au.request_id JOIN assignments a ON a.id=f.assignment_id
    WHERE a.worker_id=d.worker_id AND au.state<>'cleaned')
  AND NOT EXISTS(SELECT 1 FROM clarifications c JOIN assignments a ON a.id=c.assignment_id WHERE a.worker_id=d.worker_id AND (c.reason<>'[Deleted]' OR c.notes<>''))
  AND NOT EXISTS(SELECT 1 FROM presentation_artifacts p WHERE p.worker_id=d.worker_id
    AND ((p.status='ready' AND p.text<>'[Deleted]') OR p.status='pending'))
  AND NOT EXISTS(SELECT 1 FROM answer_presentation_bindings b JOIN presentation_artifacts p ON p.id=b.presentation_id
    WHERE p.worker_id=d.worker_id AND b.presented_question<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM instruction_deliveries del WHERE del.worker_id=d.worker_id AND del.content_json IS NOT NULL
    AND del.content_json->>'title' IS DISTINCT FROM '[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM directory_reactivations re WHERE re.worker_id=d.worker_id AND re.expected_label<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id WHERE a.worker_id=d.worker_id
    AND e.created_at<=d.created_at AND (e.status<>'expired' OR e.snapshot_json IS NOT NULL OR e.csv IS NOT NULL OR e.checksum IS NOT NULL OR e.lease_token IS NOT NULL))`;

const recordings=async(client,id)=>(await client.query(`SELECT rec.id,rec.org_id,rec.site_id FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=$1
  UNION ALL SELECT au.id,au.org_id,au.site_id FROM case_followup_audio au JOIN case_followups f ON f.id=au.request_id
    JOIN assignments a ON a.id=f.assignment_id WHERE a.worker_id=$1
  UNION ALL SELECT v.id,v.org_id,v.site_id FROM case_voice v WHERE v.worker_id=$1 ORDER BY id`,[id])).rows;
const recordingKeys=(rows)=>JSON.stringify(rows.map(row=>[row.id,row.org_id,row.site_id]));
async function snapshotsClear(client,row){
  const imports=(await client.query('SELECT filename,filename_hash,rows_json FROM worker_imports WHERE org_id=$1 AND (rows_json IS NOT NULL OR filename_hash IS NULL)',[row.org_id])).rows;
  const exports=(await client.query(`SELECT DISTINCT e.id,e.snapshot_json FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id
    WHERE a.worker_id=$1 AND e.snapshot_json IS NOT NULL`,[row.worker_id])).rows;
  return deletionSnapshotsClear(imports,exports,row.code_hash);
}

export async function processOneDeletionCompletion(pool,storage,{schema='public'}={}){
  const selected=await domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`${candidate} ORDER BY d.created_at,d.id LIMIT 1`)).rows[0];
    if(!row || !await snapshotsClear(client,row))return null;
    return {row,objects:await recordings(client,row.worker_id)};
  });
  if(!selected)return false;
  const {row,objects}=selected;
  if(objects.length && typeof storage?.exists!=='function')return false;
  for(const object of objects)if(await storage.exists(object)!==false)return false;
  return domainTransaction(pool,schema,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`deletion-completion:${row.id}`]);
    const current=(await client.query(`${candidate} AND d.id=$1 FOR UPDATE OF w`,[row.id])).rows[0];
    if(!current || recordingKeys(await recordings(client,row.worker_id))!==recordingKeys(objects) || !await snapshotsClear(client,current))return false;
    await client.query('INSERT INTO worker_deletion_completions VALUES($1,$2,$3,$4,clock_timestamp())',[row.id,row.org_id,row.site_id,row.worker_id]);
    await domainAudit(client,{...row,principal_type:'system',principal_id:'deletion-worker'},'worker.deletion.completed',row.worker_id);
    return true;
  });
}
