import {randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {ensureDeletionRedactionSchema} from './deletion-redactions.mjs';
import {audioStore} from './private-storage.mjs';
import {DEFAULT_AUDIO_ROOT} from './recordings.mjs';
import {deletionSnapshotsClear} from './deletion-verification.mjs';
import {ensureStaffCaseRecordingSchema} from './staff-case-recording-schema.mjs';

const candidate=`SELECT d.*,p.code_hash FROM worker_deletion_requests d JOIN worker_deletion_pseudonyms p ON p.request_id=d.id
  JOIN worker_deletion_redactions rd ON rd.request_id=d.id JOIN workers w ON w.id=d.worker_id AND w.active=0 AND w.code=p.pseudonym
  WHERE NOT EXISTS(SELECT 1 FROM worker_deletion_completions c WHERE c.request_id=d.id)
  AND NOT EXISTS(SELECT 1 FROM worker_grants g WHERE g.worker_id=d.worker_id AND g.revoked_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.principal_type='worker' AND s.principal_id=d.worker_id AND s.revoked_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM crew_memberships cm WHERE cm.worker_id=d.worker_id)
  AND NOT EXISTS(SELECT 1 FROM case_voice v WHERE v.worker_id=d.worker_id AND v.cleanup_state<>'cleaned')
  AND NOT EXISTS(SELECT 1 FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=d.worker_id
    AND (rec.status<>'failed' OR rec.transcript IS NOT NULL OR rec.lease_token IS NOT NULL OR rec.lease_until IS NOT NULL OR rec.retry_at IS NOT NULL
      OR NOT EXISTS(SELECT 1 FROM recording_purges pur WHERE pur.recording_id=rec.id AND pur.status='complete')))
  AND NOT EXISTS(SELECT 1 FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=d.worker_id
    AND rec.presented_question IS NOT NULL AND rec.presented_question<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM attempts t JOIN assignments a ON a.id=t.assignment_id WHERE a.worker_id=d.worker_id
    AND (t.answer_text<>'[Deleted]' OR t.reasons_json<>'{"reasons":[],"evidence":[]}'))
  AND NOT EXISTS(SELECT 1 FROM presentation_artifacts p WHERE p.worker_id=d.worker_id
    AND ((p.status='ready' AND p.text<>'[Deleted]') OR p.status='pending'))
  AND NOT EXISTS(SELECT 1 FROM answer_presentation_bindings b JOIN presentation_artifacts p ON p.id=b.presentation_id
    WHERE p.worker_id=d.worker_id AND b.presented_question<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM instruction_deliveries del WHERE del.worker_id=d.worker_id AND del.content_json IS NOT NULL
    AND json_extract(del.content_json,'$.title')<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM help_requests h JOIN assignments a ON a.id=h.assignment_id WHERE a.worker_id=d.worker_id AND h.text<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM case_messages m JOIN assignments a ON a.id=m.assignment_id WHERE a.worker_id=d.worker_id AND m.text<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM clarifications c JOIN assignments a ON a.id=c.assignment_id WHERE a.worker_id=d.worker_id AND (c.reason<>'[Deleted]' OR c.notes<>''))
  AND NOT EXISTS(SELECT 1 FROM directory_reactivations re WHERE re.worker_id=d.worker_id AND re.expected_label<>'[Deleted]')
  AND NOT EXISTS(SELECT 1 FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id WHERE a.worker_id=d.worker_id
    AND e.created_at<=d.created_at AND (e.status<>'expired' OR e.snapshot_json IS NOT NULL OR e.csv IS NOT NULL OR e.checksum IS NOT NULL OR e.lease_token IS NOT NULL))`;

const recordings=(db,id)=>db.prepare(`SELECT rec.id,rec.org_id,rec.site_id FROM recordings rec JOIN assignments a ON a.id=rec.assignment_id WHERE a.worker_id=?
  UNION ALL SELECT id,org_id,site_id FROM case_voice WHERE worker_id=? ORDER BY id`).all(id,id);
const recordingKeys=(rows)=>JSON.stringify(rows.map(row=>[row.id,row.org_id,row.site_id]));

function snapshotsClear(db,row){
  const imports=db.prepare('SELECT filename,filename_hash,rows_json FROM worker_imports WHERE org_id=? AND (rows_json IS NOT NULL OR filename_hash IS NULL)').all(row.org_id);
  const exports=db.prepare(`SELECT DISTINCT e.id,e.snapshot_json FROM report_exports e JOIN assignments a ON a.publication_id=e.publication_id
    WHERE a.worker_id=? AND e.snapshot_json IS NOT NULL`).all(row.worker_id);
  return deletionSnapshotsClear(imports,exports,row.code_hash);
}

export async function processOneDeletionCompletion(db,storage=DEFAULT_AUDIO_ROOT){
  ensureDeletionRedactionSchema(db);
  ensureStaffCaseRecordingSchema(db);
  const row=db.prepare(`${candidate} ORDER BY d.created_at,d.id LIMIT 1`).get();
  if(!row || !snapshotsClear(db,row))return false;
  const objects=recordings(db,row.worker_id),store=audioStore(storage);
  if(objects.length && typeof store?.exists!=='function')return false;
  for(const object of objects)if(await store.exists(object)!==false)return false;
  return transaction(db,()=>{
    const current=db.prepare(`${candidate} AND d.id=?`).get(row.id);
    if(!current || recordingKeys(recordings(db,row.worker_id))!==recordingKeys(objects) || !snapshotsClear(db,current))return false;
    const now=NOW();
    db.prepare('INSERT INTO worker_deletion_completions VALUES(?,?,?,?,?)').run(row.id,row.org_id,row.site_id,row.worker_id,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),row.org_id,row.site_id,'system','deletion-worker','worker.deletion.completed',row.worker_id,now);
    return true;
  });
}
