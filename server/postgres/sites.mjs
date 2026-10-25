import {randomUUID} from 'node:crypto';
import {domainTransaction,requirePrincipal,domainAudit} from './domain.mjs';
import {lockStaffAccount} from './auth.mjs';
import {linkAccountMembership} from './accounts.mjs';
import {createSiteInput,siteFilters,siteRequestId,siteAccessInput} from '../site-input.mjs';
import {siteLifecycleInput} from '../site-lifecycle-input.mjs';
import {requireSiteOperational,siteLifecycleState,siteArchiveDependencies} from './site-lifecycle.mjs';
async function authority(client,session,credential=false) {
  if(session?.principal_type!=='staff' || session.role!=='owner')throw Error('Forbidden');
  const account=await lockStaffAccount(client,session.principal_id);await requirePrincipal(client,session,'staff',['owner']);
  const available=session.access_mode==='credential' && account && (await client.query('SELECT 1 FROM staff_credentials WHERE staff_id=$1',[account.credential_staff_id])).rows.length;
  if(credential && !available)throw Error('Forbidden');return available?account:null;
}
export function listSites(pool,session,input={},{schema='public'}={}) {
  const f=siteFilters(input);return domainTransaction(pool,schema,async client=>{const account=await authority(client,session),args=[session.org_id,f.search.toLowerCase()],where='s.org_id=$1 AND strpos(lower(s.name),$2)>0';
    const total=(await client.query(`SELECT COUNT(*)::int n FROM sites s WHERE ${where}`,args)).rows[0].n;
    const items=(await client.query(`SELECT s.id,s.name,s.timezone,(SELECT COUNT(*)::int FROM workers w WHERE w.org_id=s.org_id AND w.site_id=s.id AND w.active=true) AS workers FROM sites s WHERE ${where} ORDER BY lower(s.name) COLLATE "C",s.id COLLATE "C" LIMIT $3 OFFSET $4`,[...args,f.pageSize,(f.page-1)*f.pageSize])).rows;
    for(const row of items){const control=(await client.query('SELECT revision,state FROM site_access_controls WHERE site_id=$1 AND org_id=$2',[row.id,session.org_id])).rows[0];
      row.accessRevision=control?.revision ?? 0;row.workerAccess=control?.state ?? 'active';row.canManageAccess=!!account && !!(await client.query(`SELECT 1 FROM staff_account_memberships m JOIN staff s ON s.id=m.staff_id
        WHERE m.account_id=$1 AND s.org_id=$2 AND s.site_id=$3 AND s.active=true AND s.role='owner'`,[account.account_id,session.org_id,row.id])).rows.length;
      const lifecycle=await siteLifecycleState(client,session.org_id,row.id);row.lifecycle=lifecycle.state;row.lifecycleRevision=lifecycle.revision;
      row.canManageLifecycle=row.canManageAccess;row.canManageAccess=row.canManageAccess && lifecycle.state==='active';}
    return {items:items.map(row=>({...row,current:row.id===session.site_id})),total,page:f.page,pageSize:f.pageSize,canCreate:!!account};});
}
export function createSite(pool,session,input,{schema='public'}={}) {
  const value=createSiteInput(input);return domainTransaction(pool,schema,async client=>{const account=await authority(client,session,true);
    await client.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[session.org_id]);
    const old=(await client.query('SELECT * FROM site_creations WHERE org_id=$1 AND request_id=$2',[session.org_id,input.requestId])).rows[0];
    if(old){if(old.created_by!==session.principal_id || old.origin_site_id!==session.site_id || JSON.stringify(createSiteInput({...old.request_json,requestId:input.requestId}))!==JSON.stringify(value))throw Error('Site creation request conflict');return {id:old.site_id,ownerId:old.owner_id,duplicate:true};}
    if((await client.query('SELECT 1 FROM sites WHERE org_id=$1 AND lower(name)=lower($2)',[session.org_id,value.name])).rows.length)throw Error('Site name already exists');
    const id=randomUUID(),ownerId=randomUUID(),name=(await client.query('SELECT name FROM staff WHERE id=$1',[session.principal_id])).rows[0].name;
    await client.query('INSERT INTO sites VALUES($1,$2,$3,$4)',[id,session.org_id,value.name,value.timezone]);
    await client.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,$2,$3,$4,'owner')",[ownerId,session.org_id,id,name]);
    await linkAccountMembership(client,account.account_id,ownerId);
    await client.query('INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id,first_run_completed_at) VALUES($1,$2,0,$3,$4,clock_timestamp())',[id,session.org_id,JSON.stringify(value.generationLanguages),ownerId]);
    await client.query('INSERT INTO site_creations(request_id,org_id,origin_site_id,site_id,created_by,owner_id,request_json) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.requestId,session.org_id,session.site_id,id,session.principal_id,ownerId,JSON.stringify(value)]);
    await domainAudit(client,session,'site.created',id);return {id,ownerId,duplicate:false};});
}
export function siteCreationReceipt(pool,session,id,{schema='public'}={}) {
  siteRequestId(id);return domainTransaction(pool,schema,async client=>{await authority(client,session,true);
    const row=(await client.query('SELECT site_id,owner_id,request_json FROM site_creations WHERE org_id=$1 AND origin_site_id=$2 AND created_by=$3 AND request_id=$4',[session.org_id,session.site_id,session.principal_id,id])).rows[0];
    return row?{found:true,id:row.site_id,ownerId:row.owner_id,request:row.request_json}:{found:false};});
}
export function saveSiteAccess(pool,session,input,{schema='public'}={}) {
  const value=siteAccessInput(input);return domainTransaction(pool,schema,async client=>{const account=await authority(client,session,true);
    // Same account and site row locks serialize replay, policy changes and worker admission.
    const old=(await client.query('SELECT *,request_json=$3::jsonb AS matches FROM site_access_requests WHERE org_id=$1 AND request_id=$2',[session.org_id,input.requestId,JSON.stringify(value)])).rows[0];
    if(old){if(old.actor_id!==session.principal_id || old.origin_site_id!==session.site_id || !old.matches)throw Error('Site access request conflict');return {revision:old.revision,state:value.state,siteId:value.siteId,duplicate:true};}
    if(!(await client.query(`SELECT 1 FROM staff_account_memberships m JOIN staff s ON s.id=m.staff_id WHERE m.account_id=$1 AND s.org_id=$2 AND s.site_id=$3 AND s.active=true AND s.role='owner'`,[account.account_id,session.org_id,value.siteId])).rows.length)throw Error('Forbidden');
    await client.query('SELECT id FROM sites WHERE id=$1 AND org_id=$2 FOR UPDATE',[value.siteId,session.org_id]);
    await requireSiteOperational(client,session.org_id,value.siteId);
    const current=(await client.query('SELECT revision,state FROM site_access_controls WHERE site_id=$1 AND org_id=$2',[value.siteId,session.org_id])).rows[0];
    if((current?.revision ?? 0)!==value.revision)throw Error('Site access revision changed');
    if((current?.state ?? 'active')===value.state)throw Error('Site access unchanged');
    const revision=value.revision+1;
    await client.query(`INSERT INTO site_access_controls(site_id,org_id,revision,state,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,reason=excluded.reason,updated_at=clock_timestamp()`,[value.siteId,session.org_id,revision,value.state,value.reason]);
    if(value.state==='paused'){
      await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE org_id=$1 AND site_id=$2 AND principal_type='worker' AND revoked_at IS NULL",[session.org_id,value.siteId]);
      await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE org_id=$1 AND site_id=$2 AND revoked_at IS NULL',[session.org_id,value.siteId]);
      await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE org_id=$1 AND site_id=$2 AND revoked_at IS NULL',[session.org_id,value.siteId]);
    }
    await client.query('INSERT INTO site_access_requests(request_id,org_id,origin_site_id,site_id,actor_id,request_json,revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.requestId,session.org_id,session.site_id,value.siteId,session.principal_id,JSON.stringify(value),revision]);
    await domainAudit(client,session,`site.worker_access_${value.state}`,value.siteId);return {revision,state:value.state,siteId:value.siteId,duplicate:false};});
}
async function lifecycleTarget(client,account,orgId,id,lock=false) {
  if(typeof id!=='string' || !(await client.query(`SELECT 1 FROM staff_account_memberships m JOIN staff s ON s.id=m.staff_id
    WHERE m.account_id=$1 AND s.org_id=$2 AND s.site_id=$3 AND s.active=true AND s.role='owner'`,[account.account_id,orgId,id])).rows.length)throw Error('Forbidden');
  await client.query(`SELECT id FROM sites WHERE id=$1 AND org_id=$2 FOR ${lock?'UPDATE':'SHARE'}`,[id,orgId]);
}
export function inspectSiteLifecycle(pool,session,id,{schema='public'}={}) {
  return domainTransaction(pool,schema,async client=>{const account=await authority(client,session,true);await lifecycleTarget(client,account,session.org_id,id);
    return {siteId:id,...await siteLifecycleState(client,session.org_id,id),dependencies:await siteArchiveDependencies(client,session.org_id,id)};});
}
export function saveSiteLifecycle(pool,session,input,{schema='public'}={}) {
  const value=siteLifecycleInput(input);return domainTransaction(pool,schema,async client=>{const account=await authority(client,session,true);
    const old=(await client.query('SELECT *,request_json=$3::jsonb AS matches FROM site_lifecycle_requests WHERE org_id=$1 AND request_id=$2',[session.org_id,input.requestId,JSON.stringify(value)])).rows[0];
    if(old){if(old.actor_id!==session.principal_id || old.origin_site_id!==session.site_id || !old.matches)throw Error('Site lifecycle request conflict');return {siteId:value.siteId,state:value.state,revision:old.revision,duplicate:true};}
    await lifecycleTarget(client,account,session.org_id,value.siteId,true);
    const current=await siteLifecycleState(client,session.org_id,value.siteId);
    if(current.revision!==value.revision)throw Error('Site lifecycle revision changed');
    if(current.state===value.state)throw Error('Site lifecycle unchanged');
    if(value.state==='archived' && (await siteArchiveDependencies(client,session.org_id,value.siteId)).length)throw Error('Site has active dependencies');
    const revision=value.revision+1;
    await client.query(`INSERT INTO site_lifecycle(site_id,org_id,revision,state,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,reason=excluded.reason,updated_at=clock_timestamp()`,[value.siteId,session.org_id,revision,value.state,value.reason]);
    if(value.state==='archived'){
      await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE org_id=$1 AND site_id=$2 AND principal_type='worker' AND revoked_at IS NULL",[session.org_id,value.siteId]);
      await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE org_id=$1 AND site_id=$2 AND revoked_at IS NULL',[session.org_id,value.siteId]);
      await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE org_id=$1 AND site_id=$2 AND revoked_at IS NULL',[session.org_id,value.siteId]);
      await client.query(`INSERT INTO site_access_controls(site_id,org_id,revision,state,reason) VALUES($1,$2,1,'paused','operational') ON CONFLICT(site_id) DO UPDATE SET revision=site_access_controls.revision+1,state='paused',reason='operational',updated_at=clock_timestamp()`,[value.siteId,session.org_id]);
    }
    await client.query('INSERT INTO site_lifecycle_requests(request_id,org_id,origin_site_id,site_id,actor_id,request_json,revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.requestId,session.org_id,session.site_id,value.siteId,session.principal_id,JSON.stringify(value),revision]);
    await domainAudit(client,session,`site.${value.state==='archived'?'archived':'restored'}`,value.siteId);return {siteId:value.siteId,state:value.state,revision,duplicate:false};});
}
export function siteLifecycleReceipt(pool,session,id,{schema='public'}={}) {
  siteRequestId(id);return domainTransaction(pool,schema,async client=>{await authority(client,session,true);
    const row=(await client.query('SELECT revision,request_json FROM site_lifecycle_requests WHERE org_id=$1 AND origin_site_id=$2 AND actor_id=$3 AND request_id=$4',[session.org_id,session.site_id,session.principal_id,id])).rows[0];
    return row?{found:true,revision:row.revision,request:row.request_json}:{found:false};});
}
export function siteAccessReceipt(pool,session,id,{schema='public'}={}) {
  siteRequestId(id);return domainTransaction(pool,schema,async client=>{await authority(client,session,true);
    const row=(await client.query('SELECT revision,request_json FROM site_access_requests WHERE org_id=$1 AND origin_site_id=$2 AND actor_id=$3 AND request_id=$4',[session.org_id,session.site_id,session.principal_id,id])).rows[0];
    return row?{found:true,revision:row.revision,request:row.request_json}:{found:false};});
}
