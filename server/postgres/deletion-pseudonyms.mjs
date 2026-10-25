import {createHash,randomUUID} from 'node:crypto';
import {domainTransaction,domainAudit} from './domain.mjs';

export async function processOneDeletionPseudonym(pool,{schema='public'}={}){
  return domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT d.*,w.code FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id AND NOT w.active
      JOIN worker_deletion_redactions r ON r.request_id=d.id
      WHERE NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.request_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=d.worker_id
        AND (rec.transcript IS NOT NULL OR NOT EXISTS(SELECT 1 FROM recording_purges p WHERE p.recording_id=rec.id AND p.status='complete')))
      AND NOT EXISTS(SELECT 1 FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id
        WHERE a.worker_id=d.worker_id AND e.status<>'expired')
      AND NOT EXISTS(SELECT 1 FROM worker_imports i WHERE i.org_id=d.org_id AND (strpos(i.filename,w.code)>0 OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(i.rows_json,'[]'::jsonb)) entry WHERE entry->>'workerId'=w.code)))
      AND NOT EXISTS(SELECT 1 FROM directory_reactivations re WHERE re.worker_id=d.worker_id AND re.expected_label<>'[Deleted]')
      AND NOT EXISTS(SELECT 1 FROM worker_grants g WHERE g.worker_id=d.worker_id AND g.revoked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.principal_type='worker' AND s.principal_id=d.worker_id AND s.revoked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM assessment_jobs j JOIN assignments a ON a.id=j.assignment_id
        WHERE a.worker_id=d.worker_id AND j.status NOT IN ('complete','blocked'))
      ORDER BY d.created_at,d.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED`)).rows[0];
    if(!row)return false;
    const pseudonym=`Deleted ${randomUUID()}`;
    await client.query('INSERT INTO worker_deletion_pseudonyms VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())',
      [row.id,row.org_id,row.site_id,row.worker_id,createHash('sha256').update(row.code).digest('hex'),pseudonym]);
    await client.query('UPDATE workers SET code=$1,name=NULL WHERE id=$2',[pseudonym,row.worker_id]);
    await client.query('DELETE FROM crew_memberships WHERE worker_id=$1',[row.worker_id]);
    await client.query('DELETE FROM worker_credentials WHERE worker_id=$1',[row.worker_id]);
    await client.query('DELETE FROM worker_setup_tokens WHERE worker_id=$1',[row.worker_id]);
    await domainAudit(client,{...row,principal_type:'system',principal_id:'deletion-worker'},'worker.identity.pseudonymized',row.worker_id);
    return true;
  });
}
