import {randomBytes,randomUUID} from 'node:crypto';
import {inSchema,insertSession} from './auth.mjs';
import {tokenHash,passwordRecord,passwordMatches} from '../auth-crypto.mjs';
import {consumeAuthBudget} from './auth-budget.mjs';
import {requireTenantActive,lockOperationsGate} from './operations-gates.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {companyLocator,normalizeWorkerLogin,workerLoginInput,workerSetupClaimInput,credentialSetupInput,assignedCredentialInput} from '../worker-credentials-input.mjs';

const WORKER_AUTH_LIMIT=8;

async function requireCredentialStaff(client,session){
  if(session?.principal_type!=='staff' || !['owner','supervisor'].includes(session.role)) throw new Error('Forbidden');
  await requireTenantActive(client,session.org_id);
  const row=(await client.query(`SELECT id FROM staff WHERE id=$1 AND org_id=$2 AND site_id=$3 AND role=$4 AND active=true FOR SHARE`,
    [session.principal_id,session.org_id,session.site_id,session.role])).rows[0];
  if(!row) throw new Error('Forbidden');
}

async function workerRow(client,session,workerId,lock=false){
  if(typeof workerId!=='string' || !workerId || workerId.length>100) throw new Error('Worker unavailable');
  const row=(await client.query(`SELECT id,code,name,active,org_id,site_id FROM workers
    WHERE id=$1 AND org_id=$2 AND site_id=$3 ${lock ? 'FOR UPDATE' : ''}`,[workerId,session.org_id,session.site_id])).rows[0];
  if(!row) throw new Error('Worker unavailable');
  return row;
}

function loginFor(code){
  try{return normalizeWorkerLogin(code);}catch{return null;}
}

function authKeys(company,login,remoteAddress){
  if(typeof remoteAddress!=='string' || remoteAddress.length>128) throw new Error('Invalid credentials');
  return {accountKey:tokenHash(`worker-account:${company}:${login}`),ipKey:tokenHash(`worker-ip:${remoteAddress}`)};
}

function setupFailure(){return new Error('Invalid or expired setup code');}

async function recordFailure(client,key){
  await client.query(`INSERT INTO auth_attempts(key_hash,count,window_started_at) VALUES($1,1,clock_timestamp())
    ON CONFLICT(key_hash) DO UPDATE SET count=CASE WHEN auth_attempts.window_started_at<=clock_timestamp()-interval '15 minutes'
      THEN 1 ELSE auth_attempts.count+1 END,
      window_started_at=CASE WHEN auth_attempts.window_started_at<=clock_timestamp()-interval '15 minutes'
      THEN clock_timestamp() ELSE auth_attempts.window_started_at END`,[key]);
}

async function recordFailures(client,keys){
  for(const key of keys) await recordFailure(client,key);
}

async function revokeWorkerAccess(client,worker){
  await client.query(`UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL`,
    [worker.id,worker.org_id,worker.site_id]);
  await client.query(`UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL`,
    [worker.id,worker.org_id,worker.site_id]);
  await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='worker' AND principal_id=$1
    AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL`,[worker.id,worker.org_id,worker.site_id]);
}

async function audit(client,session,action,objectId){
  await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),session.org_id,session.site_id,session.principal_type,session.principal_id,action,objectId]);
}

export async function workerCompanyContext(pool,input,{schema='public'}={}){
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>key!=='company'))
    throw new Error('Invalid input');
  const company=companyLocator(input.company);
  return inSchema(pool,schema,async client=>{
    const row=(await client.query('SELECT id,name FROM organizations WHERE lower(id)=$1',[company])).rows[0];
    if(!row) throw new Error('Company not found');
    return {company:{id:row.id,name:row.name}};
  });
}

export async function workerCredentialStatus(pool,session,workerId,{schema='public'}={}){
  return inSchema(pool,schema,async client=>{
    await requireCredentialStaff(client,session);
    const worker=await workerRow(client,session,workerId);
    const credential=(await client.query(`SELECT worker_id,login_id,state,credential_revision,setup_issued_at,password_changed_at,updated_at
      FROM worker_credentials WHERE worker_id=$1 AND org_id=$2 AND site_id=$3`,[worker.id,session.org_id,session.site_id])).rows[0];
    const token=credential?.state==='setup' ? (await client.query(`SELECT expires_at,created_at,used_at,revoked_at FROM worker_setup_tokens
      WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,[worker.id,session.org_id,session.site_id])).rows[0] : null;
    const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const available=!!token && !token.used_at && !token.revoked_at && token.expires_at>now;
    return {workerId:worker.id,workerCode:worker.code,workerName:worker.name,workerActive:!!worker.active,
      companyId:session.org_id,state:credential?.state ?? 'none',loginId:credential?.login_id ?? loginFor(worker.code),
      credentialRevision:credential?.credential_revision ?? 0,
      setupExpiresAt:token?.expires_at ? new Date(token.expires_at).toISOString() : null,
      setupAvailable:available,
      passwordChangedAt:credential?.password_changed_at ? new Date(credential.password_changed_at).toISOString() : null,
      updatedAt:credential?.updated_at ? new Date(credential.updated_at).toISOString() : null};
  });
}

export async function issueWorkerCredentialSetup(pool,session,workerId,input,{schema='public'}={}){
  const value=credentialSetupInput(input);
  return inSchema(pool,schema,async client=>{
    await requireCredentialStaff(client,session);
    await requireWorkerSiteAccess(client,session.org_id,session.site_id);
    const worker=await workerRow(client,session,workerId,true);
    if(!worker.active) throw new Error('Worker unavailable');
    const login=normalizeWorkerLogin(worker.code);
    if(normalizeWorkerLogin(value.expectedCode)!==login) throw new Error('Worker code changed');
    const conflict=(await client.query('SELECT worker_id FROM worker_credentials WHERE org_id=$1 AND login_id=$2 AND worker_id<>$3',
      [session.org_id,login,worker.id])).rows[0];
    if(conflict) throw new Error('Worker ID already in use');
    const previous=(await client.query('SELECT state FROM worker_credentials WHERE worker_id=$1 FOR UPDATE',[worker.id])).rows[0];
    await revokeWorkerAccess(client,worker);
    const token=randomBytes(32).toString('base64url'),id=randomUUID();
    const tokenRow=(await client.query(`INSERT INTO worker_setup_tokens
      (id,org_id,site_id,worker_id,token_hash,expires_at,used_at,revoked_at,created_by,created_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp()+$6*interval '1 minute',NULL,NULL,$7,clock_timestamp()) RETURNING expires_at`,
    [id,worker.org_id,worker.site_id,worker.id,tokenHash(token),value.expiresInMinutes,session.principal_id])).rows[0];
    const credential=(await client.query(`INSERT INTO worker_credentials
      (worker_id,org_id,site_id,login_id,state,password_salt,password_hash,credential_revision,setup_issued_at,password_changed_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,'setup',NULL,NULL,1,clock_timestamp(),NULL,clock_timestamp(),clock_timestamp())
      ON CONFLICT(worker_id) DO UPDATE SET login_id=excluded.login_id,state='setup',password_salt=NULL,password_hash=NULL,
        credential_revision=worker_credentials.credential_revision+1,setup_issued_at=excluded.setup_issued_at,
        password_changed_at=NULL,updated_at=excluded.updated_at
      RETURNING credential_revision`,[worker.id,worker.org_id,worker.site_id,login])).rows[0];
    await audit(client,session,previous?.state==='active' ? 'worker.credential_reset_issued' : 'worker.credential_setup_issued',worker.id);
    return {workerId:worker.id,companyId:worker.org_id,loginId:login,state:'setup',setupCode:token,
      setupExpiresAt:new Date(tokenRow.expires_at).toISOString(),expiresInMinutes:value.expiresInMinutes,
      credentialRevision:credential.credential_revision};
  });
}

const setupLookup=`SELECT t.id AS token_id,t.expires_at,t.used_at,t.revoked_at,c.worker_id,c.org_id,c.site_id,c.login_id,
  c.state,c.credential_revision,w.code,w.name,w.active
  FROM worker_setup_tokens t
  JOIN workers w ON w.id=t.worker_id AND w.org_id=t.org_id AND w.site_id=t.site_id
  JOIN worker_credentials c ON c.worker_id=w.id AND c.org_id=w.org_id AND c.site_id=w.site_id
  JOIN organizations o ON o.id=w.org_id
  WHERE t.token_hash=$1 AND lower(o.id)=$2 AND c.login_id=$3
  FOR UPDATE OF t,c,w`;

function setupUsable(row){
  return !!row && !!row.active && row.state==='setup' && !row.used_at && !row.revoked_at && row.expires_at>new Date();
}

export async function completeWorkerSetup(pool,input,remoteAddress='',{schema='public'}={}){
  const value=workerSetupClaimInput(input);
  const keys=authKeys(value.company,value.login,remoteAddress);
  let session=null;
  try{
    session=await inSchema(pool,schema,async client=>{
      await lockOperationsGate(client);
      if(!await consumeAuthBudget(client,[keys.accountKey,keys.ipKey],WORKER_AUTH_LIMIT,{increment:false}))
        throw setupFailure();
      const row=(await client.query(setupLookup,[tokenHash(value.code),value.company,value.login])).rows[0];
      if(!setupUsable(row)){
        await recordFailures(client,[keys.accountKey,keys.ipKey]);
        return null;
      }
      try{await requireTenantActive(client,row.org_id);await requireWorkerSiteAccess(client,row.org_id,row.site_id);}
      catch{
        await recordFailures(client,[keys.accountKey,keys.ipKey]);
        return null;
      }
      const record=await passwordRecord(value.password);
      const used=(await client.query(`UPDATE worker_setup_tokens SET used_at=clock_timestamp()
        WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,[row.token_id])).rows[0];
      if(!used) throw setupFailure();
      const activated=(await client.query(`UPDATE worker_credentials SET state='active',password_salt=$2,password_hash=$3,
        password_changed_at=clock_timestamp(),credential_revision=credential_revision+1,updated_at=clock_timestamp()
        WHERE worker_id=$1 AND state='setup' AND credential_revision=$4 AND login_id=$5 RETURNING credential_revision`,
      [row.worker_id,record.salt,record.derived,row.credential_revision,row.login_id])).rows[0];
      if(!activated) throw setupFailure();
      const worker={id:row.worker_id,org_id:row.org_id,site_id:row.site_id};
      await revokeWorkerAccess(client,worker);
      const result=await insertSession(client,worker,'worker',null,8*3600,activated.credential_revision);
      await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
        VALUES($1,$2,$3,'worker',$4,'worker.credential_activated',$4)`,
      [randomUUID(),row.org_id,row.site_id,row.worker_id]);
      await client.query('DELETE FROM auth_attempts WHERE key_hash=$1',[keys.accountKey]);
      return {...result,workerId:row.worker_id,companyId:row.org_id};
    });
  }catch(error){
    if(error.message==='Invalid or expired setup code'){
      await inSchema(pool,schema,client=>recordFailures(client,[keys.accountKey,keys.ipKey]));
    }
    throw error;
  }
  if(!session) throw setupFailure();
  return session;
}

const loginLookup=`SELECT c.worker_id,c.org_id,c.site_id,c.login_id,c.state,c.credential_revision,c.password_salt,
  c.password_hash,c.password_changed_at,w.code,w.name,w.active
  FROM worker_credentials c JOIN workers w ON w.id=c.worker_id AND w.org_id=c.org_id AND w.site_id=c.site_id
  JOIN organizations o ON o.id=w.org_id
  WHERE lower(o.id)=$1 AND c.login_id=$2 AND c.state='active' AND w.active=true
  FOR UPDATE OF c,w`;

function loginUsable(row){
  return !!row && !!row.active && row.state==='active';
}

export async function authenticateWorker(pool,input,remoteAddress='',{schema='public'}={}){
  const value=workerLoginInput(input);
  const keys=authKeys(value.company,value.login,remoteAddress);
  const session=await inSchema(pool,schema,async client=>{
    await lockOperationsGate(client);
    if(!await consumeAuthBudget(client,[keys.accountKey,keys.ipKey],WORKER_AUTH_LIMIT,{increment:false}))
      return null;
    const row=(await client.query(loginLookup,[value.company,value.login])).rows[0];
    const matches=await passwordMatches(value.password,row);
    if(!loginUsable(row) || !matches){
      await recordFailures(client,[keys.accountKey,keys.ipKey]);
      return null;
    }
    try{await requireTenantActive(client,row.org_id);await requireWorkerSiteAccess(client,row.org_id,row.site_id);}
    catch{
      await recordFailures(client,[keys.accountKey,keys.ipKey]);
      return null;
    }
    const current=(await client.query(`SELECT c.credential_revision,c.password_hash FROM worker_credentials c
      JOIN workers w ON w.id=c.worker_id AND w.org_id=c.org_id AND w.site_id=c.site_id
      WHERE c.worker_id=$1 AND c.org_id=$2 AND c.site_id=$3 AND c.state='active' AND w.active=true
      FOR SHARE OF c,w`,[row.worker_id,row.org_id,row.site_id])).rows[0];
    if(!current || current.credential_revision!==row.credential_revision || current.password_hash!==row.password_hash)
      return null;
    const worker={id:row.worker_id,org_id:row.org_id,site_id:row.site_id};
    let grantId=null,maxSeconds=8*3600;
    if(value.token){
      const grant=(await client.query(`SELECT id,floor(EXTRACT(EPOCH FROM expires_at-clock_timestamp()))::int AS seconds FROM worker_grants WHERE token_hash=$1 AND worker_id=$2 AND org_id=$3 AND site_id=$4 AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[tokenHash(value.token),row.worker_id,row.org_id,row.site_id])).rows[0];
      if(!grant || grant.seconds<1){await recordFailures(client,[keys.accountKey,keys.ipKey]);return null;}
      await client.query('UPDATE worker_grants SET redeemed_at=clock_timestamp() WHERE id=$1',[grant.id]);
      grantId=grant.id;maxSeconds=Math.min(2*3600,grant.seconds);
    }
    const result=await insertSession(client,worker,'worker',grantId,maxSeconds,grantId?null:current.credential_revision);
    await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id)
      VALUES($1,$2,$3,'worker',$4,'worker.signed_in',$4)`,
    [randomUUID(),row.org_id,row.site_id,row.worker_id]);
    await client.query('DELETE FROM auth_attempts WHERE key_hash=$1',[keys.accountKey]);
    return {...result,workerId:row.worker_id,companyId:row.org_id};
  });
  if(!session) throw new Error('Invalid credentials');
  return session;
}

export {companyLocator,normalizeWorkerLogin};

export async function assignWorkerPassword(pool,session,workerId,input,{schema='public'}={}){
  const value=assignedCredentialInput(input,session?.org_id || ''),record=await passwordRecord(value.password);
  return inSchema(pool,schema,async client=>{
    await requireCredentialStaff(client,session);await requireWorkerSiteAccess(client,session.org_id,session.site_id);
    const worker=await workerRow(client,session,workerId,true);
    if(!worker.active)throw new Error('Worker unavailable');
    if(normalizeWorkerLogin(worker.code)!==value.expectedCode)throw new Error('Worker code changed');
    if((await client.query('SELECT worker_id FROM worker_credentials WHERE org_id=$1 AND login_id=$2 AND worker_id<>$3',[session.org_id,value.login,worker.id])).rows.length)throw new Error('Worker ID already in use');
    await revokeWorkerAccess(client,worker);
    await client.query("UPDATE worker_credentials SET state='setup',password_salt=NULL,password_hash=NULL,password_changed_at=NULL,credential_revision=credential_revision+1,updated_at=clock_timestamp() WHERE worker_id=$1",[worker.id]);
    await client.query(`INSERT INTO worker_credentials(worker_id,org_id,site_id,login_id,state,password_salt,password_hash,credential_revision,setup_issued_at,password_changed_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,'active',$5,$6,1,NULL,clock_timestamp(),clock_timestamp(),clock_timestamp()) ON CONFLICT(worker_id) DO UPDATE SET login_id=excluded.login_id,state='active',password_salt=excluded.password_salt,password_hash=excluded.password_hash,credential_revision=worker_credentials.credential_revision+1,setup_issued_at=NULL,password_changed_at=excluded.password_changed_at,updated_at=excluded.updated_at`,[worker.id,worker.org_id,worker.site_id,value.login,record.salt,record.derived]);
    await audit(client,session,'worker.password_assigned',worker.id);
    return {workerId:worker.id,companyId:worker.org_id,loginId:value.login,state:'active'};
  });
}
