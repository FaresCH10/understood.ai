import {NOW,transaction} from './db.mjs';
import {scheduleAuthority} from './schedules.mjs';
import {ensureRecordingSchema} from './recordings.mjs';
import {ensureDeletionSchema} from './deletions.mjs';
import {recordWorkerEvent} from './notification-events.mjs';

export function queuePublicationReminders(db,session,publicationId,request) {
  if(!request.reminderMinutes)return;
  const authority=JSON.stringify(scheduleAuthority(db,session));
  const publication=db.prepare('SELECT published_at FROM publications WHERE id=?').get(publicationId);
  const dueAt=new Date(Math.max(Date.parse(publication.published_at),Date.parse(request.dueAt)-request.reminderMinutes*60000)).toISOString();
  db.prepare(`INSERT OR IGNORE INTO assignment_reminders(assignment_id,org_id,site_id,publication_id,worker_id,requested_by,authority_json,due_at,state)
    SELECT id,org_id,site_id,publication_id,worker_id,?,?,?,'queued' FROM assignments WHERE publication_id=? AND org_id=? AND site_id=?`)
    .run(session.principal_id,authority,dueAt,publicationId,session.org_id,session.site_id);
}
export function processOneReminder(db) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='submission_receipts'").get())ensureRecordingSchema(db);
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='worker_deletion_requests'").get())ensureDeletionSchema(db);
  return transaction(db,()=>{
    const now=NOW(),row=db.prepare("SELECT * FROM assignment_reminders WHERE state='queued' AND due_at<=? ORDER BY due_at,assignment_id LIMIT 1").get(now);
    if(!row)return false;
    const old=JSON.parse(row.authority_json),session={principal_type:'staff',principal_id:row.requested_by,role:old.role,org_id:row.org_id,site_id:row.site_id};
    let authorized=false;
    try {authorized=JSON.stringify(scheduleAuthority(db,session))===row.authority_json;}
    catch(error){if(!['Forbidden','Sign in required'].includes(error.message))throw error;}
    const eligible=authorized && db.prepare(`SELECT 1 FROM assignments a JOIN publications p ON p.id=a.publication_id
      JOIN workers w ON w.id=a.worker_id WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?
      AND p.state='published' AND a.due_at>? AND w.active=1
      AND NOT EXISTS(SELECT 1 FROM briefing_archives b WHERE b.briefing_id=p.briefing_id)
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=a.worker_id AND d.org_id=a.org_id)
      AND NOT EXISTS(SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=a.id AND sr.org_id=a.org_id)`)
      .get(row.assignment_id,row.org_id,row.site_id,row.worker_id,now);
    db.prepare("UPDATE assignment_reminders SET state=?,finished_at=? WHERE assignment_id=? AND state='queued'").run(eligible?'visible':'skipped',now,row.assignment_id);
    if(eligible)recordWorkerEvent(db,{orgId:row.org_id,siteId:row.site_id,workerId:row.worker_id,kind:'deadline.reminder',
      objectType:'assignment',objectId:row.assignment_id,dedupeKey:`deadline.reminder:${row.assignment_id}`,now});
    return true;
  });
}
