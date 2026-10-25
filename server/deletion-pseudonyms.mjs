import {createHash,randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureDeletionRedactionSchema} from './deletion-redactions.mjs';

export function processOneDeletionPseudonym(db){
  ensureDeletionRedactionSchema(db);
  return transaction(db,()=>{
    const row=db.prepare(`SELECT d.*,w.code FROM worker_deletion_requests d JOIN workers w ON w.id=d.worker_id AND w.active=0
      JOIN worker_deletion_redactions r ON r.request_id=d.id
      WHERE NOT EXISTS(SELECT 1 FROM worker_deletion_pseudonyms p WHERE p.request_id=d.id)
      AND NOT EXISTS(SELECT 1 FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=d.worker_id
        AND (rec.transcript IS NOT NULL OR NOT EXISTS(SELECT 1 FROM recording_purges p WHERE p.recording_id=rec.id AND p.status='complete')))
      AND NOT EXISTS(SELECT 1 FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id
        WHERE a.worker_id=d.worker_id AND e.status<>'expired')
      AND NOT EXISTS(SELECT 1 FROM worker_imports i WHERE i.org_id=d.org_id AND (instr(i.filename,w.code)>0 OR EXISTS(
        SELECT 1 FROM json_each(COALESCE(i.rows_json,'[]')) entry WHERE json_extract(entry.value,'$.workerId')=w.code)))
      AND NOT EXISTS(SELECT 1 FROM directory_reactivations re WHERE re.worker_id=d.worker_id AND re.expected_label<>'[Deleted]')
      AND NOT EXISTS(SELECT 1 FROM worker_grants g WHERE g.worker_id=d.worker_id AND g.revoked_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.principal_type='worker' AND s.principal_id=d.worker_id AND s.revoked_at IS NULL)
      ORDER BY d.created_at,d.id LIMIT 1`).get();
    if(!row)return false;
    const pseudonym=`Deleted ${randomUUID()}`,now=NOW();
    db.prepare('INSERT INTO worker_deletion_pseudonyms VALUES(?,?,?,?,?,?,?)')
      .run(row.id,row.org_id,row.site_id,row.worker_id,createHash('sha256').update(row.code).digest('hex'),pseudonym,now);
    db.prepare('UPDATE workers SET code=?,name=NULL WHERE id=?').run(pseudonym,row.worker_id);
    db.prepare('DELETE FROM crew_memberships WHERE worker_id=?').run(row.worker_id);
    db.prepare('DELETE FROM worker_credentials WHERE worker_id=?').run(row.worker_id);
    db.prepare('DELETE FROM worker_setup_tokens WHERE worker_id=?').run(row.worker_id);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),row.org_id,row.site_id,'system','deletion-worker','worker.identity.pseudonymized',row.worker_id,now);
    return true;
  });
}
