import {randomUUID} from 'node:crypto';
import {transaction,NOW} from './db.mjs';
import {createSiteInput,siteFilters,siteRequestId,siteAccessInput} from './site-input.mjs';
import {accountIdentity} from './account-schema.mjs';
import {linkAccountMembership} from './accounts.mjs';
import {siteLifecycleInput} from './site-lifecycle-input.mjs';
import {requireSiteOperational,siteLifecycleState,siteArchiveDependencies} from './site-lifecycle.mjs';
import {ensureSiteAdmissionGuards} from './site-schema.mjs';

function authority(db,session,credential=false) {
  if(session?.principal_type!=='staff' || session.role!=='owner' || !db.prepare("SELECT 1 FROM staff WHERE id=? AND org_id=? AND site_id=? AND role='owner' AND active=1").get(session.principal_id,session.org_id,session.site_id))throw Error('Forbidden');
  if(session.token_hash && !db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND principal_id=? AND org_id=? AND site_id=? AND principal_type='staff' AND revoked_at IS NULL AND expires_at>?").get(session.token_hash,session.principal_id,session.org_id,session.site_id,NOW()))throw Error('Sign in required');
  const account=accountIdentity(db,session.principal_id),available=session.access_mode==='credential' && account?.account_active===1 && !!db.prepare('SELECT 1 FROM staff_credentials WHERE staff_id=?').get(account.credential_staff_id);
  if(credential && !available)throw Error('Forbidden');return available?account:null;
}
export function listSites(db,session,input={}) {
  const f=siteFilters(input);return transaction(db,()=>{const account=authority(db,session),args=[session.org_id,f.search.toLowerCase()],where='s.org_id=? AND instr(lower(s.name),?)>0';
    const total=db.prepare(`SELECT COUNT(*) n FROM sites s WHERE ${where}`).get(...args).n;
    const items=db.prepare(`SELECT s.id,s.name,s.timezone,(SELECT COUNT(*) FROM workers w WHERE w.org_id=s.org_id AND w.site_id=s.id AND w.active=1) AS workers FROM sites s WHERE ${where} ORDER BY lower(s.name),s.id LIMIT ? OFFSET ?`).all(...args,f.pageSize,(f.page-1)*f.pageSize);
    return {items:items.map(row=>{const control=db.prepare('SELECT revision,state FROM site_access_controls WHERE site_id=? AND org_id=?').get(row.id,session.org_id);
      const canManageAccess=!!account && !!db.prepare(`SELECT 1 FROM staff_account_memberships m JOIN staff s ON s.id=m.staff_id
        WHERE m.account_id=? AND s.org_id=? AND s.site_id=? AND s.active=1 AND s.role='owner'`).get(account.account_id,session.org_id,row.id);
      const lifecycle=siteLifecycleState(db,session.org_id,row.id);
      return {...row,current:row.id===session.site_id,lifecycleRevision:lifecycle.revision,lifecycle:lifecycle.state,canManageLifecycle:canManageAccess,
        accessRevision:control?.revision ?? 0,workerAccess:control?.state ?? 'active',canManageAccess:canManageAccess && lifecycle.state==='active'};}),total,page:f.page,pageSize:f.pageSize,canCreate:!!account};});
}
export function createSite(db,session,input) {
  const value=createSiteInput(input);return transaction(db,()=>{const account=authority(db,session,true);
    const old=db.prepare('SELECT * FROM site_creations WHERE org_id=? AND request_id=?').get(session.org_id,input.requestId);
    if(old){if(old.created_by!==session.principal_id || old.origin_site_id!==session.site_id || old.request_json!==JSON.stringify(value))throw Error('Site creation request conflict');return {id:old.site_id,ownerId:old.owner_id,duplicate:true};}
    if(db.prepare('SELECT 1 FROM sites WHERE org_id=? AND lower(name)=lower(?)').get(session.org_id,value.name))throw Error('Site name already exists');
    const id=randomUUID(),ownerId=randomUUID(),name=db.prepare('SELECT name FROM staff WHERE id=?').get(session.principal_id).name;
    db.prepare('INSERT INTO sites VALUES(?,?,?,?)').run(id,session.org_id,value.name,value.timezone);
    db.prepare("INSERT INTO staff VALUES(?,?,?,?, 'owner',1)").run(ownerId,session.org_id,id,name);
    linkAccountMembership(db,account.account_id,ownerId);
    db.prepare('INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id,first_run_completed_at) VALUES(?,?,0,?,?,?)').run(id,session.org_id,JSON.stringify(value.generationLanguages),ownerId,NOW());
    db.prepare('INSERT INTO site_creations VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,id,session.principal_id,ownerId,JSON.stringify(value),NOW());
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,'site.created',id,NOW());
    return {id,ownerId,duplicate:false};});
}
export function siteCreationReceipt(db,session,id) {
  siteRequestId(id);return transaction(db,()=>{authority(db,session,true);
    const row=db.prepare('SELECT site_id,owner_id,request_json FROM site_creations WHERE org_id=? AND origin_site_id=? AND created_by=? AND request_id=?').get(session.org_id,session.site_id,session.principal_id,id);
    return row?{found:true,id:row.site_id,ownerId:row.owner_id,request:JSON.parse(row.request_json)}:{found:false};});
}
export function saveSiteAccess(db,session,input) {
  const value=siteAccessInput(input);return transaction(db,()=>{const account=authority(db,session,true);
    const old=db.prepare('SELECT * FROM site_access_requests WHERE org_id=? AND request_id=?').get(session.org_id,input.requestId);
    if(old){if(old.actor_id!==session.principal_id || old.origin_site_id!==session.site_id || old.request_json!==JSON.stringify(value))throw Error('Site access request conflict');return {revision:old.revision,state:value.state,siteId:value.siteId,duplicate:true};}
    if(!db.prepare(`SELECT 1 FROM staff_account_memberships m JOIN staff s ON s.id=m.staff_id WHERE m.account_id=? AND s.org_id=? AND s.site_id=? AND s.active=1 AND s.role='owner'`).get(account.account_id,session.org_id,value.siteId))throw Error('Forbidden');
    requireSiteOperational(db,session.org_id,value.siteId);
    const current=db.prepare('SELECT revision,state FROM site_access_controls WHERE site_id=? AND org_id=?').get(value.siteId,session.org_id);
    if((current?.revision ?? 0)!==value.revision)throw Error('Site access revision changed');
    if((current?.state ?? 'active')===value.state)throw Error('Site access unchanged');
    const revision=value.revision+1,now=NOW();
    db.prepare(`INSERT INTO site_access_controls VALUES(?,?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at`).run(value.siteId,session.org_id,revision,value.state,value.reason,now);
    if(value.state==='paused'){
      db.prepare("UPDATE sessions SET revoked_at=? WHERE org_id=? AND site_id=? AND principal_type='worker' AND revoked_at IS NULL").run(now,session.org_id,value.siteId);
      db.prepare('UPDATE worker_grants SET revoked_at=? WHERE org_id=? AND site_id=? AND revoked_at IS NULL').run(now,session.org_id,value.siteId);
      db.prepare('UPDATE worker_setup_tokens SET revoked_at=? WHERE org_id=? AND site_id=? AND revoked_at IS NULL').run(now,session.org_id,value.siteId);
    }
    db.prepare('INSERT INTO site_access_requests VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,value.siteId,session.principal_id,JSON.stringify(value),revision,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,`site.worker_access_${value.state}`,value.siteId,now);
    return {revision,state:value.state,siteId:value.siteId,duplicate:false};});
}
export function inspectSiteLifecycle(db,session,id) {
  return transaction(db,()=>{const account=authority(db,session,true);lifecycleTarget(db,account,session.org_id,id);
    return {siteId:id,...siteLifecycleState(db,session.org_id,id),dependencies:siteArchiveDependencies(db,session.org_id,id)};});
}
function lifecycleTarget(db,account,orgId,id) {
  if(typeof id!=='string' || !db.prepare(`SELECT 1 FROM staff_account_memberships m JOIN staff s ON s.id=m.staff_id
    WHERE m.account_id=? AND s.org_id=? AND s.site_id=? AND s.active=1 AND s.role='owner'`).get(account.account_id,orgId,id))throw Error('Forbidden');
}
export function saveSiteLifecycle(db,session,input) {
  const value=siteLifecycleInput(input);ensureSiteAdmissionGuards(db);
  return transaction(db,()=>{const account=authority(db,session,true);
    const old=db.prepare('SELECT * FROM site_lifecycle_requests WHERE org_id=? AND request_id=?').get(session.org_id,input.requestId);
    if(old){if(old.actor_id!==session.principal_id || old.origin_site_id!==session.site_id || old.request_json!==JSON.stringify(value))throw Error('Site lifecycle request conflict');return {siteId:value.siteId,state:value.state,revision:old.revision,duplicate:true};}
    lifecycleTarget(db,account,session.org_id,value.siteId);
    const current=siteLifecycleState(db,session.org_id,value.siteId);
    if(current.revision!==value.revision)throw Error('Site lifecycle revision changed');
    if(current.state===value.state)throw Error('Site lifecycle unchanged');
    if(value.state==='archived' && siteArchiveDependencies(db,session.org_id,value.siteId).length)throw Error('Site has active dependencies');
    const now=NOW(),revision=value.revision+1;
    db.prepare(`INSERT INTO site_lifecycle VALUES(?,?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at`).run(value.siteId,session.org_id,revision,value.state,value.reason,now);
    if(value.state==='archived'){
      db.prepare("UPDATE sessions SET revoked_at=? WHERE org_id=? AND site_id=? AND principal_type='worker' AND revoked_at IS NULL").run(now,session.org_id,value.siteId);
      db.prepare('UPDATE worker_grants SET revoked_at=? WHERE org_id=? AND site_id=? AND revoked_at IS NULL').run(now,session.org_id,value.siteId);
      db.prepare('UPDATE worker_setup_tokens SET revoked_at=? WHERE org_id=? AND site_id=? AND revoked_at IS NULL').run(now,session.org_id,value.siteId);
      db.prepare(`INSERT INTO site_access_controls VALUES(?,?,1,'paused','operational',?) ON CONFLICT(site_id) DO UPDATE SET revision=site_access_controls.revision+1,state='paused',reason='operational',updated_at=excluded.updated_at`).run(value.siteId,session.org_id,now);
    }
    db.prepare('INSERT INTO site_lifecycle_requests VALUES(?,?,?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,value.siteId,session.principal_id,JSON.stringify(value),revision,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),session.org_id,session.site_id,'staff',session.principal_id,`site.${value.state==='archived'?'archived':'restored'}`,value.siteId,now);
    return {siteId:value.siteId,state:value.state,revision,duplicate:false};});
}
export function siteLifecycleReceipt(db,session,id) {
  siteRequestId(id);return transaction(db,()=>{authority(db,session,true);
    const row=db.prepare('SELECT revision,request_json FROM site_lifecycle_requests WHERE org_id=? AND origin_site_id=? AND actor_id=? AND request_id=?').get(session.org_id,session.site_id,session.principal_id,id);
    return row?{found:true,revision:row.revision,request:JSON.parse(row.request_json)}:{found:false};});
}
export function siteAccessReceipt(db,session,id) {
  siteRequestId(id);return transaction(db,()=>{authority(db,session,true);
    const row=db.prepare('SELECT revision,request_json FROM site_access_requests WHERE org_id=? AND origin_site_id=? AND actor_id=? AND request_id=?').get(session.org_id,session.site_id,session.principal_id,id);
    return row?{found:true,revision:row.revision,request:JSON.parse(row.request_json)}:{found:false};});
}
