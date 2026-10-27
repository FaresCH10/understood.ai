import {randomBytes,randomUUID} from 'node:crypto';
import {NOW,transaction} from './db.mjs';
import {tokenHash,passwordRecordSync,passwordMatchesSync} from './auth-crypto.mjs';
import {consumeAuthBudget,recordAuthFailure} from './auth-budget.mjs';
import {createSession} from './auth.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {companyLocator,normalizeWorkerLogin,workerLoginInput,workerSetupClaimInput,credentialSetupInput,assignedCredentialInput} from './worker-credentials-input.mjs';

const WORKER_AUTH_LIMIT=8;

function requireCredentialStaff(db,session){
  if(session?.principal_type!=='staff' || !['owner','administrator','supervisor'].includes(session.role)
    || !db.prepare('SELECT id FROM staff WHERE id=? AND org_id=? AND site_id=? AND role=? AND active=1')
      .get(session.principal_id,session.org_id,session.site_id,session.role)) throw new Error('Forbidden');
}

function workerScope(db,session,workerId){
  if(typeof workerId!=='string' || !workerId || workerId.length>100) throw new Error('Worker unavailable');
  const worker=db.prepare('SELECT id,code,name,active,org_id,site_id FROM workers WHERE id=? AND org_id=? AND site_id=?')
    .get(workerId,session.org_id,session.site_id);
  if(!worker) throw new Error('Worker unavailable');
  return worker;
}

function loginFor(code){
  try{return normalizeWorkerLogin(code);}catch{return null;}
}

function authKeys(company,login,remoteAddress){
  if(typeof remoteAddress!=='string' || remoteAddress.length>128) throw new Error('Invalid credentials');
  return {accountKey:tokenHash(`worker-account:${company}:${login}`),ipKey:tokenHash(`worker-ip:${remoteAddress}`)};
}

function setupFailure(){return new Error('Invalid or expired setup code');}

function revokeWorkerAccess(db,worker,now){
  db.prepare('UPDATE worker_grants SET revoked_at=? WHERE worker_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL')
    .run(now,worker.id,worker.org_id,worker.site_id);
  db.prepare('UPDATE worker_setup_tokens SET revoked_at=? WHERE worker_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL')
    .run(now,worker.id,worker.org_id,worker.site_id);
  db.prepare("UPDATE sessions SET revoked_at=? WHERE principal_type='worker' AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL")
    .run(now,worker.id,worker.org_id,worker.site_id);
}

export function workerCompanyContext(db,input){
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>key!=='company'))
    throw new Error('Invalid input');
  const company=companyLocator(input.company);
  const row=db.prepare('SELECT id,name FROM organizations WHERE lower(id)=?').get(company);
  if(!row) throw new Error('Company not found');
  return {company:{id:row.id,name:row.name}};
}

export function workerCredentialStatus(db,session,workerId){
  return transaction(db,()=>{
    requireCredentialStaff(db,session);
    const worker=workerScope(db,session,workerId);
    const credential=db.prepare(`SELECT worker_id,login_id,state,credential_revision,setup_issued_at,password_changed_at,updated_at
      FROM worker_credentials WHERE worker_id=? AND org_id=? AND site_id=?`).get(worker.id,session.org_id,session.site_id);
    const token=credential?.state==='setup' ? db.prepare(`SELECT expires_at,created_at,used_at,revoked_at FROM worker_setup_tokens
      WHERE worker_id=? AND org_id=? AND site_id=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(worker.id,session.org_id,session.site_id) : null;
    const available=!!token && !token.used_at && !token.revoked_at && token.expires_at>NOW();
    return {workerId:worker.id,workerCode:worker.code,workerName:worker.name,workerActive:!!worker.active,
      companyId:session.org_id,state:credential?.state ?? 'none',loginId:credential?.login_id ?? loginFor(worker.code),
      credentialRevision:credential?.credential_revision ?? 0,setupExpiresAt:token?.expires_at ?? null,
      setupAvailable:available,passwordChangedAt:credential?.password_changed_at ?? null,updatedAt:credential?.updated_at ?? null};
  });
}

export function issueWorkerCredentialSetup(db,session,workerId,input){
  const value=credentialSetupInput(input);
  return transaction(db,()=>{
    requireCredentialStaff(db,session);
    requireWorkerSiteAccess(db,session.org_id,session.site_id);
    const worker=workerScope(db,session,workerId);
    if(!worker.active) throw new Error('Worker unavailable');
    const login=normalizeWorkerLogin(worker.code);
    if(normalizeWorkerLogin(value.expectedCode)!==login) throw new Error('Worker code changed');
    const conflict=db.prepare('SELECT worker_id FROM worker_credentials WHERE org_id=? AND login_id=? AND worker_id<>?')
      .get(session.org_id,login,worker.id);
    if(conflict) throw new Error('Worker ID already in use');
    const previous=db.prepare('SELECT state FROM worker_credentials WHERE worker_id=?').get(worker.id);
    const now=NOW(),token=randomBytes(32).toString('base64url'),id=randomUUID();
    const expiresAt=new Date(Date.now()+value.expiresInMinutes*60_000).toISOString();
    revokeWorkerAccess(db,worker,now);
    db.prepare(`INSERT INTO worker_credentials
      (worker_id,org_id,site_id,login_id,state,password_salt,password_hash,credential_revision,setup_issued_at,password_changed_at,created_at,updated_at)
      VALUES (?,?,?,?,'setup',NULL,NULL,1,?,NULL,?,?)
      ON CONFLICT(worker_id) DO UPDATE SET login_id=excluded.login_id,state='setup',password_salt=NULL,password_hash=NULL,
        credential_revision=worker_credentials.credential_revision+1,setup_issued_at=excluded.setup_issued_at,
        password_changed_at=NULL,updated_at=excluded.updated_at`)
      .run(worker.id,worker.org_id,worker.site_id,login,now,now,now);
    db.prepare(`INSERT INTO worker_setup_tokens(id,org_id,site_id,worker_id,token_hash,expires_at,used_at,revoked_at,created_by,created_at)
      VALUES (?,?,?,?,?,?,NULL,NULL,?,?)`)
      .run(id,worker.org_id,worker.site_id,worker.id,tokenHash(token),expiresAt,session.principal_id,now);
    const revision=db.prepare('SELECT credential_revision FROM worker_credentials WHERE worker_id=?').get(worker.id).credential_revision;
    db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),worker.org_id,worker.site_id,'staff',session.principal_id,
      previous?.state==='active' ? 'worker.credential_reset_issued' : 'worker.credential_setup_issued',worker.id,now);
    return {workerId:worker.id,companyId:worker.org_id,loginId:login,state:'setup',setupCode:token,
      setupExpiresAt:expiresAt,expiresInMinutes:value.expiresInMinutes,credentialRevision:revision};
  });
}

export function completeWorkerSetup(db,input,remoteAddress=''){
  const value=workerSetupClaimInput(input);
  const keys=authKeys(value.company,value.login,remoteAddress);
  if(!transaction(db,()=>consumeAuthBudget(db,[keys.accountKey,keys.ipKey],WORKER_AUTH_LIMIT,{increment:false})))
    throw setupFailure();
  const lookup=`SELECT t.id AS token_id,t.expires_at,t.used_at,t.revoked_at,c.worker_id,c.org_id,c.site_id,c.login_id,
      c.state,c.credential_revision,w.code,w.name,w.active
    FROM worker_setup_tokens t
    JOIN workers w ON w.id=t.worker_id AND w.org_id=t.org_id AND w.site_id=t.site_id
    JOIN worker_credentials c ON c.worker_id=w.id AND c.org_id=w.org_id AND c.site_id=w.site_id
    JOIN organizations o ON o.id=w.org_id
    WHERE t.token_hash=? AND lower(o.id)=? AND c.login_id=?`;
  const row=db.prepare(lookup).get(tokenHash(value.code),value.company,value.login);
  if(!row || !row.active || row.state!=='setup' || row.used_at || row.revoked_at || row.expires_at<=NOW()){
    recordAuthFailure(db,keys.accountKey);recordAuthFailure(db,keys.ipKey);
    throw setupFailure();
  }
  try{requireWorkerSiteAccess(db,row.org_id,row.site_id);}catch{
    recordAuthFailure(db,keys.accountKey);recordAuthFailure(db,keys.ipKey);
    throw setupFailure();
  }
  const record=passwordRecordSync(value.password);
  try{
    return transaction(db,()=>{
      const now=NOW();
      const current=db.prepare(lookup).get(tokenHash(value.code),value.company,value.login);
      if(!current || !current.active || current.state!=='setup' || current.used_at || current.revoked_at || current.expires_at<=now
        || current.credential_revision!==row.credential_revision) throw setupFailure();
      const used=db.prepare('UPDATE worker_setup_tokens SET used_at=? WHERE id=? AND used_at IS NULL AND revoked_at IS NULL')
        .run(now,current.token_id).changes;
      if(used!==1) throw setupFailure();
      const activated=db.prepare(`UPDATE worker_credentials SET state='active',password_salt=?,password_hash=?,
        password_changed_at=?,credential_revision=credential_revision+1,updated_at=?
        WHERE worker_id=? AND state='setup' AND credential_revision=? AND login_id=?`)
        .run(record.salt,record.derived,now,now,current.worker_id,current.credential_revision,current.login_id).changes;
      if(activated!==1) throw setupFailure();
      revokeWorkerAccess(db,{id:current.worker_id,org_id:current.org_id,site_id:current.site_id},now);
      const revision=db.prepare('SELECT credential_revision FROM worker_credentials WHERE worker_id=?').get(current.worker_id).credential_revision;
      const session=createSession(db,{id:current.worker_id,org_id:current.org_id,site_id:current.site_id},'worker','credential',null,8*3600,revision);
      db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),current.org_id,current.site_id,'worker',
        current.worker_id,'worker.credential_activated',current.worker_id,now);
      db.prepare('DELETE FROM auth_attempts WHERE key_hash=?').run(keys.accountKey);
      return {...session,workerId:current.worker_id,companyId:current.org_id};
    });
  }catch(error){
    if(error.message==='Invalid or expired setup code'){
      recordAuthFailure(db,keys.accountKey);recordAuthFailure(db,keys.ipKey);
    }
    throw error;
  }
}

export function authenticateWorker(db,input,remoteAddress=''){
  const value=workerLoginInput(input);
  const keys=authKeys(value.company,value.login,remoteAddress);
  if(!transaction(db,()=>consumeAuthBudget(db,[keys.accountKey,keys.ipKey],WORKER_AUTH_LIMIT,{increment:false})))
    throw new Error('Invalid credentials');
  const query=`SELECT c.worker_id,c.org_id,c.site_id,c.login_id,c.state,c.credential_revision,c.password_salt,
      c.password_hash,c.password_changed_at,w.code,w.name,w.active
    FROM worker_credentials c JOIN workers w ON w.id=c.worker_id AND w.org_id=c.org_id AND w.site_id=c.site_id
    JOIN organizations o ON o.id=w.org_id
    WHERE lower(o.id)=? AND c.login_id=? AND c.state='active' AND w.active=1`;
  const row=db.prepare(query).get(value.company,value.login);
  const matches=passwordMatchesSync(value.password,row);
  if(!row || !matches){
    recordAuthFailure(db,keys.accountKey);recordAuthFailure(db,keys.ipKey);
    throw new Error('Invalid credentials');
  }
  try{requireWorkerSiteAccess(db,row.org_id,row.site_id);}catch{
    recordAuthFailure(db,keys.accountKey);recordAuthFailure(db,keys.ipKey);
    throw new Error('Invalid credentials');
  }
  try{
    return transaction(db,()=>{
      const current=db.prepare(query).get(value.company,value.login);
      if(!current || current.credential_revision!==row.credential_revision || current.password_hash!==row.password_hash)
        throw new Error('Invalid credentials');
      let grantId=null,maxSeconds=8*3600;
      if(value.token){
        const grant=db.prepare(`SELECT * FROM worker_grants WHERE token_hash=? AND worker_id=? AND org_id=? AND site_id=?`).get(tokenHash(value.token),current.worker_id,current.org_id,current.site_id);
        if(!grant || grant.used_at || grant.redeemed_at || grant.revoked_at || grant.expires_at<=NOW())throw new Error('Invalid credentials');
        maxSeconds=Math.min(2*3600,Math.floor((Date.parse(grant.expires_at)-Date.now())/1000));
        if(maxSeconds<1)throw new Error('Invalid credentials');
        if(db.prepare('UPDATE worker_grants SET redeemed_at=? WHERE id=? AND redeemed_at IS NULL AND revoked_at IS NULL').run(NOW(),grant.id).changes!==1)throw new Error('Invalid credentials');
        grantId=grant.id;
      }
      const session=createSession(db,{id:current.worker_id,org_id:current.org_id,site_id:current.site_id},'worker','credential',grantId,maxSeconds,grantId?null:current.credential_revision);
      db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),current.org_id,current.site_id,'worker',
        current.worker_id,'worker.signed_in',current.worker_id,NOW());
      db.prepare('DELETE FROM auth_attempts WHERE key_hash=?').run(keys.accountKey);
      return {...session,workerId:current.worker_id,companyId:current.org_id};
    });
  }catch(error){
    if(error.message==='Invalid credentials'){recordAuthFailure(db,keys.accountKey);recordAuthFailure(db,keys.ipKey);}
    throw error;
  }
}

export {companyLocator,normalizeWorkerLogin};

export function assignWorkerPassword(db,session,workerId,input){
  const value=assignedCredentialInput(input,session?.org_id || ''),record=passwordRecordSync(value.password);
  return transaction(db,()=>{
    requireCredentialStaff(db,session);requireWorkerSiteAccess(db,session.org_id,session.site_id);
    const worker=workerScope(db,session,workerId);
    if(!worker.active)throw new Error('Worker unavailable');
    if(normalizeWorkerLogin(worker.code)!==value.expectedCode)throw new Error('Worker code changed');
    if(db.prepare('SELECT worker_id FROM worker_credentials WHERE org_id=? AND login_id=? AND worker_id<>?').get(session.org_id,value.login,worker.id))throw new Error('Worker ID already in use');
    const now=NOW();revokeWorkerAccess(db,worker,now);
    db.prepare("UPDATE worker_credentials SET state='setup',password_salt=NULL,password_hash=NULL,password_changed_at=NULL,credential_revision=credential_revision+1,updated_at=? WHERE worker_id=?").run(now,worker.id);
    db.prepare(`INSERT INTO worker_credentials(worker_id,org_id,site_id,login_id,state,password_salt,password_hash,credential_revision,setup_issued_at,password_changed_at,created_at,updated_at)
      VALUES(?,?,?,?,'active',?,?,1,NULL,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET login_id=excluded.login_id,state='active',password_salt=excluded.password_salt,password_hash=excluded.password_hash,credential_revision=worker_credentials.credential_revision+1,setup_issued_at=NULL,password_changed_at=excluded.password_changed_at,updated_at=excluded.updated_at`)
      .run(worker.id,worker.org_id,worker.site_id,value.login,record.salt,record.derived,now,now,now);
    db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),worker.org_id,worker.site_id,'staff',session.principal_id,'worker.password_assigned',worker.id,now);
    return {workerId:worker.id,companyId:worker.org_id,loginId:value.login,state:'active'};
  });
}
