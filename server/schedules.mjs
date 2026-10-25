import {NOW,transaction} from './db.mjs';
import {briefingAuthority,briefingAudit} from './preparation.mjs';
import {checkedPublication,publish} from './domain.mjs';
import {scheduleInput,schedulePage,scheduleCancel,scheduleHash,scheduledContentHash,scheduleReceipt,scheduleFailure} from './schedule-input.mjs';
import {instructionModes} from './instruction-schema.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';

export function scheduleAuthority(db,session) {
  briefingAuthority(db,session);
  const access=db.prepare('SELECT revision FROM staff_access_revisions WHERE staff_id=? AND org_id=? AND site_id=?')
    .get(session.principal_id,session.org_id,session.site_id)?.revision ?? 1;
  const account=db.prepare(`SELECT a.id,a.active,a.revision FROM staff_account_memberships m
    JOIN staff_accounts a ON a.id=m.account_id WHERE m.staff_id=? AND m.org_id=? AND m.site_id=?`)
    .get(session.principal_id,session.org_id,session.site_id);
  if(account && !account.active) throw Error('Forbidden');
  if(session.token_hash!==undefined && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=?
    AND principal_type='staff' AND principal_id=? AND revoked_at IS NULL AND expires_at>?`)
    .get(session.token_hash,session.org_id,session.site_id,session.principal_id,NOW())) throw Error('Sign in required');
  return {role:session.role,accessRevision:access,accountId:account?.id ?? null,accountRevision:account?.revision ?? null};
}
export function createSchedule(db,session,briefingId,input) {
  const request=scheduleInput(input),json=JSON.stringify(request);
  return transaction(db,()=>{
    const authority=scheduleAuthority(db,session);
    const briefing=db.prepare('SELECT * FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(briefingId,session.org_id,session.site_id);
    if(!briefing) throw Error('Briefing unavailable');
    const old=db.prepare('SELECT * FROM publication_schedules WHERE id=?').get(input.requestId);
    if(old) {
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.briefing_id!==briefingId || old.request_json!==json) throw Error('Schedule request conflict');
      return {...scheduleReceipt(old),duplicate:true};
    }
    requireWritableEntitlement(db,session.org_id);
    if(request.publishAt<=NOW()) throw Error('Scheduled publication must be in the future');
    if(briefing.next_version!==request.nextVersion) throw Error('Draft revision changed');
    if(db.prepare("SELECT 1 FROM publication_schedules WHERE briefing_id=? AND state='queued'").get(briefingId)) throw Error('A publication schedule is already pending');
    if(db.prepare('SELECT 1 FROM publication_requests WHERE request_id=? AND briefing_id=? AND org_id=? AND site_id=?').get(input.requestId,briefingId,session.org_id,session.site_id)) throw Error('Schedule request conflict');
    const {workers,snapshot}=checkedPublication(db,session,briefing,request);
    db.prepare(`INSERT INTO publication_schedules(id,org_id,site_id,briefing_id,request_json,snapshot_hash,recipients_json,
      requested_by,authority_json,publish_at,created_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued')`)
      .run(input.requestId,session.org_id,session.site_id,briefingId,json,scheduleHash(snapshot),JSON.stringify(workers),session.principal_id,JSON.stringify(authority),request.publishAt,NOW());
    briefingAudit(db,session,'briefing.scheduled',input.requestId);
    return {...scheduleReceipt(db.prepare('SELECT * FROM publication_schedules WHERE id=?').get(input.requestId)),duplicate:false};
  });
}
export function listSchedules(db,session,briefingId,input={}) {
  const page=schedulePage(input);
  return transaction(db,()=>{
    scheduleAuthority(db,session);
    if(!db.prepare('SELECT id FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(briefingId,session.org_id,session.site_id)) throw Error('Briefing unavailable');
    const total=db.prepare('SELECT count(*) n FROM publication_schedules WHERE briefing_id=? AND org_id=? AND site_id=?').get(briefingId,session.org_id,session.site_id).n;
    const items=db.prepare('SELECT * FROM publication_schedules WHERE briefing_id=? AND org_id=? AND site_id=? ORDER BY created_at DESC,id LIMIT 20 OFFSET ?')
      .all(briefingId,session.org_id,session.site_id,(page-1)*20).map(scheduleReceipt);
    return {items,total,page,pageSize:20,asOf:NOW()};
  });
}
export function cancelSchedule(db,session,briefingId,id,input) {
  scheduleCancel(input);
  return transaction(db,()=>{
    scheduleAuthority(db,session);
    const row=db.prepare('SELECT * FROM publication_schedules WHERE id=? AND briefing_id=? AND org_id=? AND site_id=?').get(id,briefingId,session.org_id,session.site_id);
    if(!row) throw Error('Schedule unavailable');
    if(row.state==='cancelled')return {...scheduleReceipt(row),duplicate:true};
    if(row.state!=='queued')throw Error('Schedule is already closed');
    db.prepare("UPDATE publication_schedules SET state='cancelled',finished_at=?,retry_at=NULL WHERE id=?").run(NOW(),id);
    briefingAudit(db,session,'briefing.schedule_cancelled',id);
    return {...scheduleReceipt(db.prepare('SELECT * FROM publication_schedules WHERE id=?').get(id)),duplicate:false};
  });
}
export function processOneSchedule(db) {
  const now=NOW();
  const row=db.prepare(`SELECT s.* FROM publication_schedules s WHERE s.state='queued' AND s.publish_at<=? AND (s.retry_at IS NULL OR s.retry_at<=?)
    AND NOT EXISTS(SELECT 1 FROM organization_entitlements e WHERE e.org_id=s.org_id
      AND (e.state='read_only' OR (e.ends_at IS NOT NULL AND e.ends_at<=?)))
    ORDER BY s.publish_at,s.id LIMIT 1`).get(now,now,now);
  if(!row)return false;
  const request=JSON.parse(row.request_json),authority=JSON.parse(row.authority_json);
  const session={org_id:row.org_id,site_id:row.site_id,principal_type:'staff',principal_id:row.requested_by,role:authority.role};
  try {
    publish(db,session,row.briefing_id,{requestId:row.id,revision:request.revision,nextVersion:request.nextVersion,workerIds:request.workerIds,dueAt:request.dueAt,reminderMinutes:request.reminderMinutes},{scheduleId:row.id,
      verifySchedule:(current,briefing)=>{
        if(JSON.stringify(scheduleAuthority(db,session))!==current.authority_json) throw Error('Scheduled authority changed');
        if(briefing.next_version!==request.nextVersion || briefing.revision!==request.revision)throw Error('Draft revision changed');
        const prepared=JSON.parse(briefing.prepared_json || 'null');
        if(scheduleHash(prepared)!==current.snapshot_hash && scheduledContentHash(prepared,instructionModes(db,row.briefing_id,row.org_id,row.site_id))!==current.snapshot_hash)throw Error('Scheduled content changed');
      }});
  }catch(error) {
    if(error.message==='Workspace is read-only')return true;
    const reason=scheduleFailure(error),terminal=!!reason || row.attempts>=2;
    transaction(db,()=>{
      const changed=terminal
        ? db.prepare("UPDATE publication_schedules SET state='failed',error=?,finished_at=?,attempts=attempts+1,retry_at=NULL WHERE id=? AND state='queued' AND attempts=?")
          .run(reason || 'Publication service unavailable after three attempts',NOW(),row.id,row.attempts)
        : db.prepare("UPDATE publication_schedules SET attempts=attempts+1,retry_at=? WHERE id=? AND state='queued' AND attempts=?")
          .run(new Date(Date.now()+5000*2**row.attempts).toISOString(),row.id,row.attempts);
      if(changed.changes && terminal)briefingAudit(db,session,'briefing.schedule_failed',row.id);
    });
  }
  return true;
}
