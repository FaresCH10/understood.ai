import {domainTransaction,requirePrincipal,domainAudit,checkedPublication,publicationPreflight,publish} from './domain.mjs';
import {scheduleInput,schedulePage,scheduleCancel,scheduleHash,scheduledContentHash,scheduleReceipt,scheduleFailure} from '../schedule-input.mjs';
import {publicationInput} from '../briefing-input.mjs';
import {dispatchAllowed,dispatchPredicate} from './operations-gates.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';

async function authority(client,session) {
  await requirePrincipal(client,session,'staff');
  const access=(await client.query('SELECT revision FROM staff_access_revisions WHERE staff_id=$1 AND org_id=$2 AND site_id=$3 FOR SHARE',
    [session.principal_id,session.org_id,session.site_id])).rows[0]?.revision ?? 1;
  const account=(await client.query(`SELECT a.id,a.active,a.revision FROM staff_account_memberships m JOIN staff_accounts a ON a.id=m.account_id
    WHERE m.staff_id=$1 AND m.org_id=$2 AND m.site_id=$3 FOR SHARE OF a`,[session.principal_id,session.org_id,session.site_id])).rows[0];
  if(account && !account.active)throw Error('Forbidden');
  return {role:session.role,accessRevision:access,accountId:account?.id ?? null,accountRevision:account?.revision ?? null};
}
export {authority as scheduleAuthority};
export async function createSchedule(pool,session,briefingId,input,{schema='public',integrationMode,storage}={}) {
  const request=scheduleInput(input);
  const old=await domainTransaction(pool,schema,async client=>{
    await authority(client,session);
    const old=(await client.query('SELECT * FROM publication_schedules WHERE id=$1',[input.requestId])).rows[0];
    if(!old)return null;
    if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.briefing_id!==briefingId || scheduleHash(old.request_json)!==scheduleHash(request))throw Error('Schedule request conflict');
    return {...scheduleReceipt(old),duplicate:true};
  });
  if(old)return old;
  const publication={requestId:input.requestId,revision:request.revision,nextVersion:request.nextVersion,workerIds:request.workerIds,dueAt:request.dueAt,...(request.reminderMinutes?{reminderMinutes:request.reminderMinutes}:{})};
  const preflight=await publicationPreflight(pool,session,briefingId,publication,publicationInput(publication),{schema,integrationMode,storage});
  if(preflight?.replay)throw Error('Schedule request conflict');
  return domainTransaction(pool,schema,async client=>{
    const authorized=await authority(client,session);
    const briefing=(await client.query('SELECT * FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[briefingId,session.org_id,session.site_id])).rows[0];
    if(!briefing)throw Error('Briefing unavailable');
    const old=(await client.query('SELECT * FROM publication_schedules WHERE id=$1',[input.requestId])).rows[0];
    if(old) {
      if(old.org_id!==session.org_id || old.site_id!==session.site_id || old.briefing_id!==briefingId || scheduleHash(old.request_json)!==scheduleHash(request))throw Error('Schedule request conflict');
      return {...scheduleReceipt(old),duplicate:true};
    }
    await requireWritableEntitlement(client,session.org_id);
    if(!(await client.query('SELECT $1::timestamptz>clock_timestamp() AS valid',[request.publishAt])).rows[0].valid)throw Error('Scheduled publication must be in the future');
    if(briefing.next_version!==request.nextVersion)throw Error('Draft revision changed');
    if((await client.query("SELECT 1 FROM publication_schedules WHERE briefing_id=$1 AND state='queued'",[briefingId])).rows.length)throw Error('A publication schedule is already pending');
    if((await client.query('SELECT 1 FROM publication_requests WHERE request_id=$1 AND briefing_id=$2 AND org_id=$3 AND site_id=$4',[input.requestId,briefingId,session.org_id,session.site_id])).rows.length)throw Error('Schedule request conflict');
    const {workers,snapshot}=await checkedPublication(client,session,briefing,request,{integrationMode,preflight});
    const row=(await client.query(`INSERT INTO publication_schedules(id,org_id,site_id,briefing_id,request_json,snapshot_hash,recipients_json,requested_by,authority_json,publish_at,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued') RETURNING *`,
    [input.requestId,session.org_id,session.site_id,briefingId,JSON.stringify(request),scheduleHash(snapshot),JSON.stringify(workers),session.principal_id,JSON.stringify(authorized),request.publishAt])).rows[0];
    await domainAudit(client,session,'briefing.scheduled',row.id);
    return {...scheduleReceipt(row),duplicate:false};
  });
}
export async function listSchedules(pool,session,briefingId,input={}, {schema='public'}={}) {
  const page=schedulePage(input);
  return domainTransaction(pool,schema,async client=>{
    await authority(client,session);
    if(!(await client.query('SELECT id FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',[briefingId,session.org_id,session.site_id])).rows.length)throw Error('Briefing unavailable');
    const values=[briefingId,session.org_id,session.site_id];
    const total=(await client.query('SELECT count(*)::int AS n FROM publication_schedules WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3',values)).rows[0].n;
    const rows=(await client.query('SELECT * FROM publication_schedules WHERE briefing_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY created_at DESC,id LIMIT 20 OFFSET $4',[...values,(page-1)*20])).rows;
    return {items:rows.map(scheduleReceipt),total,page,pageSize:20,asOf:new Date().toISOString()};
  });
}
export async function cancelSchedule(pool,session,briefingId,id,input,{schema='public'}={}) {
  scheduleCancel(input);
  return domainTransaction(pool,schema,async client=>{
    await authority(client,session);
    if(!(await client.query('SELECT id FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3 FOR UPDATE',[briefingId,session.org_id,session.site_id])).rows.length)throw Error('Schedule unavailable');
    const row=(await client.query('SELECT * FROM publication_schedules WHERE id=$1 AND briefing_id=$2 AND org_id=$3 AND site_id=$4 FOR UPDATE',[id,briefingId,session.org_id,session.site_id])).rows[0];
    if(!row)throw Error('Schedule unavailable');
    if(row.state==='cancelled')return {...scheduleReceipt(row),duplicate:true};
    if(row.state!=='queued')throw Error('Schedule is already closed');
    const changed=(await client.query("UPDATE publication_schedules SET state='cancelled',finished_at=clock_timestamp(),retry_at=NULL WHERE id=$1 RETURNING *",[id])).rows[0];
    await domainAudit(client,session,'briefing.schedule_cancelled',id);
    return {...scheduleReceipt(changed),duplicate:false};
  });
}
export async function processOneSchedule(pool,{schema='public',integrationMode,storage}={}) {
  const row=await domainTransaction(pool,schema,async client=>(await client.query(`SELECT * FROM publication_schedules WHERE state='queued' AND publish_at<=clock_timestamp() AND (retry_at IS NULL OR retry_at<=clock_timestamp())
    AND ${dispatchPredicate('publication_schedules')}
    AND NOT EXISTS(SELECT 1 FROM organization_entitlements e WHERE e.org_id=publication_schedules.org_id
      AND (e.state='read_only' OR (e.ends_at IS NOT NULL AND e.ends_at<=clock_timestamp())))
    ORDER BY publish_at,id LIMIT 1`)).rows[0]);
  if(!row)return false;
  const request=row.request_json,session={org_id:row.org_id,site_id:row.site_id,principal_type:'staff',principal_id:row.requested_by,role:row.authority_json.role};
  try {
    await publish(pool,session,row.briefing_id,{requestId:row.id,revision:request.revision,nextVersion:request.nextVersion,workerIds:request.workerIds,dueAt:request.dueAt,reminderMinutes:request.reminderMinutes},{schema,integrationMode,storage,scheduleId:row.id,
      verifySchedule:async(client,current,briefing)=>{
        if(!await dispatchAllowed(client,row.org_id))throw Error('Operational dispatch paused');
        if(scheduleHash(await authority(client,session))!==scheduleHash(current.authority_json))throw Error('Scheduled authority changed');
        if(briefing.next_version!==request.nextVersion || briefing.revision!==request.revision)throw Error('Draft revision changed');
        if(scheduleHash(briefing.prepared_json)!==current.snapshot_hash && scheduledContentHash(briefing.prepared_json)!==current.snapshot_hash)throw Error('Scheduled content changed');
      }});
  }catch(error) {
    if(['Operational dispatch paused','Workspace access paused','Workspace is read-only'].includes(error.message))return true;
    const reason=scheduleFailure(error),terminal=!!reason || row.attempts>=2;
    await domainTransaction(pool,schema,async client=>{
      if(!await dispatchAllowed(client,row.org_id))return;
      // Use the same briefing -> schedule lock order as publish/cancel.
      await client.query('SELECT id FROM briefings WHERE id=$1 FOR UPDATE',[row.briefing_id]);
      const changed=terminal
        ? await client.query("UPDATE publication_schedules SET state='failed',error=$1,finished_at=clock_timestamp(),attempts=attempts+1,retry_at=NULL WHERE id=$2 AND state='queued' AND attempts=$3 RETURNING id",[reason || 'Publication service unavailable after three attempts',row.id,row.attempts])
        : await client.query("UPDATE publication_schedules SET attempts=attempts+1,retry_at=clock_timestamp()+($1::int*interval '1 millisecond') WHERE id=$2 AND state='queued' AND attempts=$3 RETURNING id",[5000*2**row.attempts,row.id,row.attempts]);
      if(changed.rows.length && terminal)await domainAudit(client,session,'briefing.schedule_failed',row.id);
    });
  }
  return true;
}
