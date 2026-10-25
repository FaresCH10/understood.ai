import {domainTransaction} from './domain.mjs';
import {scheduleAuthority} from './schedules.mjs';
import {scheduleHash} from '../schedule-input.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
import {recordWorkerEvent} from './notification-events.mjs';

export async function queuePublicationReminders(client,session,publicationId,request) {
  if(!request.reminderMinutes)return;
  const authority=await scheduleAuthority(client,session);
  await client.query(`INSERT INTO assignment_reminders(assignment_id,org_id,site_id,publication_id,worker_id,requested_by,authority_json,due_at,state)
    SELECT a.id,a.org_id,a.site_id,a.publication_id,a.worker_id,$4,$5,
      greatest(p.published_at,a.due_at-($6::int*interval '1 minute')),'queued'
    FROM assignments a JOIN publications p ON p.id=a.publication_id
    WHERE a.publication_id=$1 AND a.org_id=$2 AND a.site_id=$3
    ON CONFLICT(assignment_id) DO NOTHING`,
    [publicationId,session.org_id,session.site_id,session.principal_id,JSON.stringify(authority),request.reminderMinutes]);
}
export async function processOneReminder(pool,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{
    const row=(await client.query(`SELECT * FROM assignment_reminders WHERE state='queued' AND due_at<=clock_timestamp()
      AND ${dispatchPredicate('assignment_reminders')} ORDER BY due_at,assignment_id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if(!row || !await dispatchAllowed(client,row.org_id))return false;
    const old=row.authority_json,session={principal_type:'staff',principal_id:row.requested_by,role:old.role,org_id:row.org_id,site_id:row.site_id};
    let authorized=false;
    try {authorized=scheduleHash(await scheduleAuthority(client,session))===scheduleHash(old);}
    catch(error){if(!['Forbidden','Sign in required'].includes(error.message))throw error;}
    const assignment=(await client.query('SELECT id FROM assignments WHERE id=$1 AND org_id=$2 AND site_id=$3 AND worker_id=$4 FOR UPDATE',
      [row.assignment_id,row.org_id,row.site_id,row.worker_id])).rows[0];
    const eligible=authorized && assignment && (await client.query(`SELECT 1 FROM assignments a
      JOIN publications p ON p.id=a.publication_id JOIN workers w ON w.id=a.worker_id
      WHERE a.id=$1 AND p.state='published' AND a.due_at>clock_timestamp() AND w.active=true
      AND NOT EXISTS(SELECT 1 FROM briefing_archives b WHERE b.briefing_id=p.briefing_id)
      AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=a.worker_id AND d.org_id=a.org_id)
      AND NOT EXISTS(SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=a.id AND sr.org_id=a.org_id)
      FOR SHARE OF p,w`,[row.assignment_id])).rows.length>0;
    await client.query("UPDATE assignment_reminders SET state=$1,finished_at=clock_timestamp() WHERE assignment_id=$2 AND state='queued'",[eligible?'visible':'skipped',row.assignment_id]);
    if(eligible)await recordWorkerEvent(client,{orgId:row.org_id,siteId:row.site_id,workerId:row.worker_id,kind:'deadline.reminder',
      objectType:'assignment',objectId:row.assignment_id,dedupeKey:`deadline.reminder:${row.assignment_id}`});
    return true;
  });
}
