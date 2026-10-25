import {domainTransaction,domainAudit} from './domain.mjs';

export async function processOneDeletionRedaction(pool,{schema='public'}={}){
  return domainTransaction(pool,schema,async client=>{
    const legacy=(await client.query(`SELECT d.* FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id
      WHERE EXISTS(SELECT 1 FROM directory_reactivations r WHERE r.worker_id=d.worker_id AND r.org_id=d.org_id
        AND r.site_id=d.site_id AND r.expected_label<>'[Deleted]')
      ORDER BY d.created_at,d.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED`)).rows[0];
    if(legacy){
      await client.query("UPDATE directory_reactivations SET expected_label='[Deleted]' WHERE worker_id=$1 AND org_id=$2 AND site_id=$3",
        [legacy.worker_id,legacy.org_id,legacy.site_id]);
      await domainAudit(client,{...legacy,principal_type:'system',principal_id:'deletion-worker'},'worker.reactivation_labels.redacted',legacy.worker_id);
      return true;
    }
    const row=(await client.query(`SELECT d.* FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id AND NOT w.active
      WHERE NOT EXISTS(SELECT 1 FROM worker_deletion_redactions r WHERE r.request_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM recordings r JOIN assignments a ON a.id=r.assignment_id WHERE a.worker_id=d.worker_id
        AND NOT EXISTS(SELECT 1 FROM recording_purges p WHERE p.recording_id=r.id AND p.status='complete'))
      AND NOT EXISTS(SELECT 1 FROM case_followup_audio au JOIN case_followups f ON f.id=au.request_id JOIN assignments a ON a.id=f.assignment_id
        WHERE a.worker_id=d.worker_id AND au.state<>'cleaned')
      AND NOT EXISTS(SELECT 1 FROM case_voice v WHERE v.worker_id=d.worker_id AND v.cleanup_state<>'cleaned')
      AND NOT EXISTS(SELECT 1 FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id
        WHERE a.worker_id=d.worker_id AND e.created_at<=d.created_at AND e.status<>'expired')
      AND NOT EXISTS(SELECT 1 FROM worker_imports i WHERE i.org_id=d.org_id AND (strpos(i.filename,w.code)>0 OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(i.rows_json,'[]'::jsonb)) entry WHERE entry->>'workerId'=w.code)))
      ORDER BY d.created_at,d.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED`)).rows[0];
    if(!row)return false;
    await client.query(`UPDATE attempts SET answer_text='[Deleted]',reasons_json='[]',evidence_json='[]'
      WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)`,[row.worker_id]);
    await client.query("UPDATE help_requests SET text='[Deleted]' WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)",[row.worker_id]);
    await client.query("UPDATE case_messages SET text='[Deleted]' WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)",[row.worker_id]);
    await client.query("UPDATE case_reviews SET reason='[Deleted]' WHERE kind='disagree' AND assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)",[row.worker_id]);
    await client.query("UPDATE case_repeats SET status='cancelled' WHERE status='pending' AND assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)",[row.worker_id]);
    await client.query(`UPDATE case_followups SET source_text='[Deleted]',glossary_json='{}',manifest_json=NULL,
      status='failed',lease_token=NULL,lease_until=NULL,error_code='worker_deleted'
      WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)`,[row.worker_id]);
    await client.query("UPDATE clarifications SET reason='[Deleted]',notes='' WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1)",[row.worker_id]);
    await client.query("UPDATE worker_language_requests SET reason='[Deleted]' WHERE worker_id=$1 AND reason<>'[Deleted]'",[row.worker_id]);
    await client.query(`UPDATE presentation_artifacts SET title=CASE WHEN title IS NULL THEN NULL ELSE '[Deleted]' END,
      text='[Deleted]',question=CASE WHEN question IS NULL THEN NULL ELSE '[Deleted]' END,updated_at=clock_timestamp()
      WHERE worker_id=$1 AND status='ready' AND text<>'[Deleted]'`,[row.worker_id]);
    await client.query(`UPDATE presentation_artifacts SET status='failed',title=NULL,text=NULL,question=NULL,provider=NULL,live=NULL,
      error_code='Worker deletion pending',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
      WHERE worker_id=$1 AND status='pending'`,[row.worker_id]);
    await client.query(`UPDATE answer_presentation_bindings SET presented_question='[Deleted]'
      WHERE presentation_id IN (SELECT id FROM presentation_artifacts WHERE worker_id=$1) AND presented_question<>'[Deleted]'`,[row.worker_id]);
    await client.query(`UPDATE recordings SET presented_question='[Deleted]'
      WHERE assignment_id IN (SELECT id FROM assignments WHERE worker_id=$1) AND presented_question IS NOT NULL AND presented_question<>'[Deleted]'`,[row.worker_id]);
    await client.query(`UPDATE instruction_deliveries SET content_json='{"title":"[Deleted]","text":"[Deleted]"}'::jsonb,
      updated_at=clock_timestamp() WHERE worker_id=$1 AND content_json IS NOT NULL AND content_json->>'title'<>'[Deleted]'`,[row.worker_id]);
    await client.query('INSERT INTO worker_deletion_redactions VALUES($1,$2,$3,$4,clock_timestamp())',[row.id,row.org_id,row.site_id,row.worker_id]);
    await domainAudit(client,{...row,principal_type:'system',principal_id:'deletion-worker'},'worker.content.redacted',row.worker_id);
    return true;
  });
}
