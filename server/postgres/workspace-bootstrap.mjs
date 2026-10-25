import {randomUUID} from 'node:crypto';
import {settingsInput} from '../settings-input.mjs';
import {credentialInput,passwordRecord,passwordMatches,tokenHash} from '../auth-crypto.mjs';
import {domainTransaction,domainAudit} from './domain.mjs';

function bootstrapInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) || input.synthetic!==true || input.confirmed!==true
    || Object.keys(input).sort().join(',')!=='confirmed,generationLanguages,organizationName,owner,requestId,siteName,supportEmail,synthetic,timezone'
    || !input.owner || Array.isArray(input.owner) || Object.keys(input.owner).sort().join(',')!=='email,name,password'
    || typeof input.owner.name!=='string' || !input.owner.name.trim() || input.owner.name.length>100 || /[\x00-\x1f\x7f]/.test(input.owner.name))throw Error('Invalid workspace bootstrap');
  const organization=settingsInput('organization',{requestId:input.requestId,confirmed:true,revision:0,name:input.organizationName,supportEmail:input.supportEmail});
  const site=settingsInput('site',{requestId:input.requestId,confirmed:true,revision:0,name:input.siteName,timezone:input.timezone,generationLanguages:input.generationLanguages});
  const email=credentialInput(input.owner.email,input.owner.password);
  return {requestId:input.requestId.toLowerCase(),organizationName:organization.name,supportEmail:organization.supportEmail,
    siteName:site.name,timezone:site.timezone,generationLanguages:site.generationLanguages,ownerName:input.owner.name.trim(),ownerEmail:email};
}

// Maintenance-only, synthetic staging/rehearsal. No public/customer endpoint.
export async function bootstrapWorkspace(pool,input,config) {
  if(config?.accessMode!=='credential' || config.aiMode!=='synthetic' || config.dataClass!=='synthetic' || config.integrationMode!=='synthetic'
    || !(config.tier==='local' && /^understood_test_[a-z0-9_]+$/.test(config.schema ?? '')
      || config.tier==='staging' && /^understood_stage_[a-z0-9_]+$/.test(config.schema ?? '')))throw Error('Synthetic workspace bootstrap only');
  const value=bootstrapInput(input),hash=tokenHash(JSON.stringify(value)),password=input.owner.password,record=await passwordRecord(password);
  return domainTransaction(pool,config.schema,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`workspace-bootstrap:${value.requestId}`]);
    const old=(await client.query('SELECT * FROM workspace_bootstraps WHERE request_id=$1',[value.requestId])).rows[0];
    if(old) {
      const credential=(await client.query('SELECT password_salt,password_hash FROM staff_credentials WHERE staff_id=$1',[old.owner_id])).rows[0];
      if(old.request_hash!==hash || !await passwordMatches(password,credential))throw Error('Workspace bootstrap request conflict');
      return {orgId:old.org_id,siteId:old.site_id,ownerId:old.owner_id,duplicate:true};
    }
    if((await client.query('SELECT 1 FROM staff_credentials WHERE email=$1',[value.ownerEmail])).rows.length)throw Error('Bootstrap owner email is already registered');
    const orgId=randomUUID(),siteId=randomUUID(),ownerId=randomUUID();
    await client.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[orgId,value.organizationName]);
    await client.query('INSERT INTO sites(id,org_id,name,timezone) VALUES($1,$2,$3,$4)',[siteId,orgId,value.siteName,value.timezone]);
    await client.query("INSERT INTO staff(id,org_id,site_id,name,role) VALUES($1,$2,$3,$4,'owner')",[ownerId,orgId,siteId,value.ownerName]);
    await client.query('INSERT INTO organization_settings(org_id,revision,support_email) VALUES($1,0,$2)',[orgId,value.supportEmail]);
    await client.query('INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json,primary_contact_id,first_run_completed_at) VALUES($1,$2,0,$3,$4,clock_timestamp())',[siteId,orgId,JSON.stringify(value.generationLanguages),ownerId]);
    await client.query('INSERT INTO staff_credentials(staff_id,email,password_salt,password_hash) VALUES($1,$2,$3,$4)',[ownerId,value.ownerEmail,record.salt,record.derived]);
    await client.query('INSERT INTO workspace_bootstraps(request_id,request_hash,org_id,site_id,owner_id) VALUES($1,$2,$3,$4,$5)',[value.requestId,hash,orgId,siteId,ownerId]);
    await domainAudit(client,{org_id:orgId,site_id:siteId,principal_type:'system',principal_id:'workspace-maintenance'},'workspace.created',orgId);
    return {orgId,siteId,ownerId,duplicate:false};
  });
}
