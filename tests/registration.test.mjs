import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {tokenHash} from '../server/auth-crypto.mjs';
import {openDatabase,NOW} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {provisionStaffCredential,authenticateStaff} from '../server/auth.mjs';
import {requestRegistration,resendRegistration,processOneRegistration,verifyRegistration,expireRegistrations} from '../server/registration.mjs';
import {REGISTRATION_TRIAL_HOURS,REGISTRATION_TRIAL_WORKER_LIMIT} from '../server/registration-input.mjs';
import {resolveMailConfig} from '../server/auth-mail.mjs';
import {createAppServer} from '../server/index.mjs';
import {AUTH_MAIL_QUEUE_LIMIT} from '../server/auth-mail-budget.mjs';
import {ensureRecoverySchema} from '../server/account-recovery.mjs';
import {entitlementState} from '../server/entitlements.mjs';
import {requireWorkerCapacity} from '../server/worker-capacity.mjs';

const password='Synthetic-registration-password-123';
const email='new-owner@example.test';
const mailOptions={mode:'resend',apiKey:'re_synthetic_key',from:'support@example.test',key:'01'.repeat(32),publicOrigin:'http://127.0.0.1:3020',allowLocal:true};
const config=resolveMailConfig(mailOptions);
const value=(override={})=>({requestId:randomUUID(),ownerName:'Synthetic Owner',email,password,companyName:'Synthetic Company',country:'US',
  phone:'+1 555 0100',acceptTerms:true,acceptPrivacy:true,...override});
const dbFixture=()=>openDatabase(':memory:');
async function deliver(db,requestId,override={}) {
  await requestRegistration(db,value({requestId,...override}),randomBytes(6).toString('hex'),config);
  return dispatch(db);
}
async function dispatch(db,send) {
  let message;
  const result=await processOneRegistration(db,config,{send:send ?? (async(c,id,msg)=>{message=msg;return {providerId:'synthetic-delivery'};})});
  return {result,message,token:message?.text.match(/#verify-registration\/([A-Za-z0-9_-]{43})/)?.[1]};
}
const count=(db,table)=>db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;

test('registration validates owner input, blocks existing accounts and returns one generic response for duplicates',async()=>{
  const db=dbFixture();try {
    for(const override of [{acceptTerms:false},{acceptPrivacy:undefined},{country:'ZZ'},{phone:'call me'},{password:'short'},
      {email:'not-an-email'},{ownerName:' A '},{companyName:' '},{requestId:'not-a-uuid'},{role:'owner'}])
      await assert.rejects(requestRegistration(db,value(override),'127.0.0.1',config),/Invalid registration input/);
    for(const input of [null,[],{...value(),requestId:undefined}])
      await assert.rejects(requestRegistration(db,input,'127.0.0.1',config),/Invalid registration input/);
    await assert.rejects(requestRegistration(db,value(),'127.0.0.1',{available:false}),/Email delivery unavailable/);
    const request=value();assert.deepEqual(await requestRegistration(db,request,'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.equal(count(db,'organization_registrations'),1);assert.equal(count(db,'registration_mail'),1);
    assert.equal(count(db,'staff_credentials'),0);assert.equal(count(db,'registration_tokens'),0);
    const rows=JSON.stringify(db.prepare('SELECT * FROM organization_registrations').all())+JSON.stringify(db.prepare('SELECT * FROM registration_mail').all());
    assert(!rows.includes(email));assert(!rows.includes(password));
    assert.deepEqual(await requestRegistration(db,request,'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.deepEqual(await requestRegistration(db,value({email:email.toUpperCase()}),'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.equal(count(db,'organization_registrations'),1);assert.equal(count(db,'registration_mail'),1);
  }finally {db.close();}
});

test('registration treats an existing staff email exactly like an unknown email and never queues mail',async()=>{
  const db=dbFixture();try {
    seed(db);provisionStaffCredential(db,'maya','maya@example.test',password);
    const response=await requestRegistration(db,value({email:'maya@example.test',companyName:'Another Company'}),'127.0.0.1',config);
    assert.deepEqual(response,{accepted:true,delivery:'queued'});
    assert.equal(count(db,'organization_registrations'),0);assert.equal(count(db,'registration_mail'),0);
    assert(count(db,'organizations')>0);
  }finally {db.close();}
});

test('resend rotates the one-use token, is bounded, and never restarts a verified registration',async()=>{
  const db=dbFixture();try {
    const request=value();const first=await deliver(db,request.requestId,request);
    assert(first.token);
    assert.deepEqual(resendRegistration(db,{requestId:request.requestId,email:request.email},'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.throws(()=>verifyRegistration(db,{token:first.token},'127.0.0.1',config),/verification unavailable/);
    const second=await dispatch(db);assert(second.token);assert.notEqual(second.token,first.token);
    assert.equal(verifyRegistration(db,{token:second.token},'127.0.0.1',config).completed,true);
    const entitlement=db.prepare('SELECT * FROM organization_entitlements').get();
    assert.deepEqual(resendRegistration(db,{requestId:request.requestId,email:request.email},'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.deepEqual(db.prepare('SELECT * FROM organization_entitlements').get(),entitlement);
    assert.equal(count(db,'organization_registrations'),1);
    assert.deepEqual(resendRegistration(db,{requestId:randomUUID(),email:request.email},'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.equal(count(db,'registration_mail'),2);
  }finally {db.close();}
});

test('resend count is capped and a full shared outbox rolls registration back truthfully',async()=>{
  const db=dbFixture();try {
    const request=value();await requestRegistration(db,request,'127.0.0.1',config);
    for(let n=0;n<5;n++) assert.deepEqual(resendRegistration(db,{requestId:request.requestId,email:request.email},`resend-${n}`,config),{accepted:true,delivery:'queued'});
    assert.equal(db.prepare('SELECT resend_count FROM organization_registrations').get().resend_count,5);
    assert.deepEqual(resendRegistration(db,{requestId:request.requestId,email:request.email},'resend-limit',config),{accepted:true,delivery:'queued'});
    assert.equal(db.prepare('SELECT resend_count FROM organization_registrations').get().resend_count,5);
    assert.equal(count(db,'registration_mail'),6);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM registration_mail WHERE state='queued'").get().n,1);
    assert.throws(()=>resendRegistration(db,{requestId:'bad',email:request.email},'127.0.0.1',config),/Invalid registration input/);
  }finally {db.close();}

  const full=dbFixture();try {
    ensureRecoverySchema(full);
    const now=NOW(),expiry=new Date(Date.now()+3600000).toISOString();
    const insert=full.prepare(`INSERT INTO staff_recovery_mail(id,purpose,email_hash,payload,created_at,expires_at,next_at,state)
      VALUES(?,'reset',?,NULL,?,?,?,'queued')`);
    for(let n=0;n<AUTH_MAIL_QUEUE_LIMIT;n++) insert.run(`capacity-${n}`,'a'.repeat(64),now,expiry,now);
    await assert.rejects(requestRegistration(full,value({email:'capacity@example.test'}),'capacity-ip',config),/Email delivery unavailable/);
    assert.equal(count(full,'organization_registrations'),0);assert.equal(count(full,'registration_mail'),0);
    assert.equal(count(full,'audit'),0);
    full.prepare("UPDATE staff_recovery_mail SET state='failed' WHERE id='capacity-0'").run();
    const request=value({email:'capacity@example.test'});
    await requestRegistration(full,request,'capacity-ip',config);
    assert.equal(count(full,'organization_registrations'),1);
    assert.equal(count(full,'registration_mail'),1);
    const id=full.prepare('SELECT id FROM organization_registrations').get().id;
    insert.run('capacity-refill','a'.repeat(64),now,expiry,now);
    assert.throws(()=>resendRegistration(full,{requestId:id,email:request.email},'capacity-resend',config),/Email delivery unavailable/);
    assert.equal(count(full,'registration_mail'),1);
    full.prepare("UPDATE staff_recovery_mail SET state='failed' WHERE id IN ('capacity-1','capacity-2')").run();
    await resendRegistration(full,{requestId:id,email:request.email},'capacity-resend',config);
    assert.equal(count(full,'registration_mail'),2);
  }finally {full.close();}
});

test('invitation-like delivery failures retain the exact sealed link and only a matching provider receipt completes it',async()=>{
  const db=dbFixture();try {
    await requestRegistration(db,value(),'127.0.0.1',config);
    let original,id;
    await processOneRegistration(db,config,{send:async(c,mailId,message)=>{original=message;id=mailId;throw new Error('Unknown external acknowledgement');}});
    const retry=db.prepare('SELECT * FROM registration_mail WHERE id=?').get(id);
    assert.equal(retry.state,'queued');assert.equal(retry.attempts,1);assert(!retry.payload.includes(email));assert.equal(count(db,'registration_tokens'),1);
    db.prepare('UPDATE registration_mail SET next_at=? WHERE id=?').run('2000-01-01',id);
    await processOneRegistration(db,config,{send:async(c,mailId,message)=>{assert.equal(mailId,id);assert.deepEqual(message,original);
      db.prepare('UPDATE registration_mail SET lease_token=? WHERE id=?').run('newer-lease',id);return {providerId:'stale'};}});
    assert.equal(db.prepare('SELECT provider_id FROM registration_mail WHERE id=?').get(id).provider_id,null);
    db.prepare('UPDATE registration_mail SET lease_until=? WHERE id=?').run('2000-01-01',id);
    await processOneRegistration(db,config,{send:async(c,mailId,message)=>{assert.deepEqual(message,original);return {providerId:'final'};}});
    assert.deepEqual({...db.prepare('SELECT state,attempts,payload,provider_id FROM registration_mail WHERE id=?').get(id)},
      {state:'sent',attempts:3,payload:null,provider_id:'final'});
  }finally {db.close();}
});

test('verified activation creates exactly one workspace, owner account, 14x24h trial and audit without a session',async()=>{
  const db=dbFixture();try {
    const request=value();const delivery=await deliver(db,request.requestId,request);assert(delivery.token);
    const result=verifyRegistration(db,{token:delivery.token},'127.0.0.1',config);
    assert.deepEqual(result,{completed:true,signInRequired:true,duplicate:false});
    assert.equal(count(db,'organizations'),1);assert.equal(count(db,'sites'),1);assert.equal(count(db,'staff'),1);
    assert.equal(count(db,'staff_credentials'),1);assert.equal(count(db,'staff_accounts'),1);assert.equal(count(db,'staff_account_memberships'),1);
    assert.equal(count(db,'sessions'),0);assert.equal(count(db,'organization_entitlements'),1);assert.equal(count(db,'organization_entitlement_transitions'),1);
    const organization=db.prepare('SELECT * FROM organizations').get(),site=db.prepare('SELECT * FROM sites').get();
    const staff=db.prepare('SELECT * FROM staff').get(),credential=db.prepare('SELECT * FROM staff_credentials').get();
    const entitlement=db.prepare('SELECT * FROM organization_entitlements').get();
    assert.equal(organization.name,request.companyName);assert.equal(site.org_id,organization.id);assert.equal(site.name,request.companyName);
    assert.equal(site.timezone,'UTC');assert.equal(staff.name,request.ownerName);assert.equal(staff.role,'owner');assert.equal(staff.org_id,organization.id);
    assert.equal(credential.email,request.email);
    assert.equal(entitlement.state,'trial');assert.equal(entitlement.plan,'trial');assert.equal(entitlement.worker_limit,REGISTRATION_TRIAL_WORKER_LIMIT);
    assert.equal(entitlement.terms_reference,'terms-v1;privacy-v1');assert.equal(entitlement.revision,1);assert.equal(entitlement.updated_by,'registration');
    assert.equal(Date.parse(entitlement.ends_at)-Date.parse(entitlement.started_at),REGISTRATION_TRIAL_HOURS*3600000);
    const registration=db.prepare('SELECT * FROM organization_registrations').get();
    const transition=db.prepare('SELECT * FROM organization_entitlement_transitions').get();
    assert.equal(transition.actor_type,'registration');assert.equal(transition.actor_id,registration.id);
    assert.equal(transition.request_id,registration.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM registration_mail WHERE state='sent'").get().n,1);
    assert.equal(registration.state,'verified');assert.equal(registration.payload,null);assert.equal(registration.country,'US');
    assert.equal(registration.terms_version,'terms-v1');assert.equal(registration.privacy_version,'privacy-v1');assert(registration.acknowledged_at);
    const audit=db.prepare('SELECT * FROM audit').get();assert.equal(audit.action,'organization.registered');assert.equal(audit.org_id,organization.id);
    assert.equal(authenticateStaff(db,request.email,password,'127.0.0.1').role,'owner');
    const exact=entitlementState(db,organization.id,{now:Date.parse(entitlement.ends_at)});
    assert.equal(exact.effectiveState,'read_only');assert.equal(exact.writeAllowed,false);
    const before=db.prepare('SELECT started_at,ends_at FROM organization_entitlements').get();
    assert.deepEqual(await requestRegistration(db,value({email:request.email}),'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.deepEqual(db.prepare('SELECT started_at,ends_at FROM organization_entitlements').get(),before);
    assert.equal(count(db,'organizations'),1);assert.equal(count(db,'registration_mail'),1);
  }finally {db.close();}
});

test('trial capacity is 25 active workers across the workspace, including setup-pending identities',async()=>{
  const db=dbFixture();try {
    const delivery=await deliver(db,value().requestId);verifyRegistration(db,{token:delivery.token},'127.0.0.1',config);
    const orgId=db.prepare('SELECT org_id FROM organization_entitlements').get().org_id;
    const siteId=db.prepare('SELECT site_id FROM staff').get().site_id;
    const insert=db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES(?,?,?,?,'en',1)");
    for(let n=0;n<24;n++) insert.run(`worker-${n}`,orgId,siteId,`W${n}`);
    assert.doesNotThrow(()=>requireWorkerCapacity(db,orgId));
    insert.run('worker-24',orgId,siteId,'W24');
    assert.throws(()=>requireWorkerCapacity(db,orgId),/Worker capacity reached \(25 active workers\)/);
    assert.throws(()=>requireWorkerCapacity(db,orgId,2),/Worker capacity reached/);
  }finally {db.close();}
});

test('verification failure rolls back every workspace row, token receipt and audit',async()=>{
  const db=dbFixture();try {
    const delivery=await deliver(db,value().requestId);
    db.exec("CREATE TRIGGER fail_registration_audit BEFORE INSERT ON audit WHEN NEW.action='organization.registered' BEGIN SELECT RAISE(ABORT,'synthetic registration audit failure'); END;");
    assert.throws(()=>verifyRegistration(db,{token:delivery.token},'127.0.0.1',config),/registration audit failure/);
    for(const table of ['organizations','sites','staff','staff_credentials','staff_accounts','staff_account_memberships','organization_settings','site_settings','organization_entitlements','organization_entitlement_transitions','audit'])
      assert.equal(count(db,table),0,table);
    const token=db.prepare('SELECT * FROM registration_tokens').get();assert.equal(token.used_at,null);assert.equal(token.revoked_at,null);
    const registration=db.prepare('SELECT * FROM organization_registrations').get();assert.equal(registration.state,'pending');assert(registration.payload);
    db.exec('DROP TRIGGER fail_registration_audit');
    assert.equal(verifyRegistration(db,{token:delivery.token},'127.0.0.1',config).completed,true);
    assert.equal(count(db,'organizations'),1);
  }finally {db.close();}
});

test('expired, revoked, reused and unknown registration links never grant owner access',async()=>{
  const db=dbFixture();try {
    const revoked=value({email:'revoked@example.test'}),first=await deliver(db,revoked.requestId,revoked);
    db.prepare('UPDATE registration_tokens SET revoked_at=?').run(NOW());
    assert.throws(()=>verifyRegistration(db,{token:first.token},'127.0.0.1',config),/verification unavailable/);
    assert.throws(()=>verifyRegistration(db,{token:randomBytes(32).toString('base64url')},'127.0.0.1',config),/verification unavailable/);
    assert.throws(()=>verifyRegistration(db,{token:'short'},'127.0.0.1',config),/verification unavailable/);
    assert.equal(count(db,'organizations'),0);

    const request=value({email:'expiring@example.test'}),second=await deliver(db,request.requestId,request);
    const secret=randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO registration_mail(id,registration_id,email_hash,payload,created_at,expires_at,next_at,state)
      SELECT 'expired-mail',id,email_hash,NULL,?,?,?,'queued' FROM organization_registrations WHERE id=?`)
      .run(NOW(),new Date(Date.now()+3600000).toISOString(),NOW(),request.requestId);
    db.prepare('INSERT INTO registration_tokens(token_hash,registration_id,mail_id,expires_at) VALUES(?,?,?,?)')
      .run(tokenHash(secret),request.requestId,'expired-mail','2000-01-01');
    assert.throws(()=>verifyRegistration(db,{token:secret},'127.0.0.1',config),/verification unavailable/);
    assert.equal(db.prepare('SELECT state FROM organization_registrations WHERE id=?').get(request.requestId).state,'pending');
    assert.equal(count(db,'organizations'),0);
    db.prepare("UPDATE organization_registrations SET expires_at='2000-01-01' WHERE id=?").run(request.requestId);
    expireRegistrations(db);
    assert.equal(db.prepare('SELECT state FROM organization_registrations WHERE id=?').get(request.requestId).state,'expired');
    assert.throws(()=>verifyRegistration(db,{token:second.token},'127.0.0.1',config),/verification unavailable/);
    assert.equal(count(db,'organizations'),0);
    const fresh=await deliver(db,randomUUID(),request);assert(fresh.token);
    assert.equal(verifyRegistration(db,{token:fresh.token},'127.0.0.1',config).completed,true);
    assert.equal(count(db,'organizations'),1);assert.equal(count(db,'organization_registrations'),2);
    assert.deepEqual(verifyRegistration(db,{token:fresh.token},'127.0.0.1',config),{completed:true,signInRequired:true,duplicate:true});
  }finally {db.close();}
});

test('corrupt verification envelopes fail closed without creating a token, workspace or delivery',async()=>{
  const db=dbFixture();try {
    await requestRegistration(db,value(),'127.0.0.1',config);
    db.prepare('UPDATE registration_mail SET payload=?').run('corrupt-envelope');
    assert.equal(await processOneRegistration(db,config,{send:async()=>assert.fail('Corrupt verification must not be sent')}),true);
    assert.deepEqual({...db.prepare('SELECT state,payload,lease_token,lease_until FROM registration_mail').get()},
      {state:'failed',payload:null,lease_token:null,lease_until:null});
    assert.equal(count(db,'registration_tokens'),0);assert.equal(count(db,'organizations'),0);
    assert.equal(await processOneRegistration(db,config,{send:async()=>assert.fail('Failed verification must not repeat')}),false);
  }finally {db.close();}
});

test('pending registrations expire irreversibly but an unverified email may start a fresh registration without a trial reset',async()=>{
  const db=dbFixture();try {
    const request=value();await requestRegistration(db,request,'127.0.0.1',config);
    db.prepare("UPDATE organization_registrations SET expires_at='2000-01-01'").run();
    expireRegistrations(db);
    const expired=db.prepare('SELECT * FROM organization_registrations').get();
    assert.equal(expired.state,'expired');assert.equal(expired.payload,null);
    assert.equal(count(db,'registration_tokens'),0);
    assert.equal(count(db,'registration_mail'),1);
    assert.deepEqual({...db.prepare('SELECT state,payload FROM registration_mail').get()},{state:'ignored',payload:null});
    const again=await deliver(db,randomUUID(),request);
    assert(again.token);
    assert.equal(count(db,'organization_registrations'),1);
    assert.equal(db.prepare('SELECT state FROM organization_registrations').get().state,'pending');
    assert.equal(verifyRegistration(db,{token:again.token},'127.0.0.1',config).completed,true);
    assert.equal(count(db,'organization_entitlements'),1);
    const started=db.prepare('SELECT started_at FROM organization_entitlements').get().started_at;
    assert.deepEqual(await requestRegistration(db,value({email:request.email}),'127.0.0.1',config),{accepted:true,delivery:'queued'});
    assert.equal(db.prepare('SELECT started_at FROM organization_entitlements').get().started_at,started);
  }finally {db.close();}
});

test('registration HTTP is credential-only, origin-bound, query-free and never signs the owner in',async()=>{
  const db=dbFixture(),server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',mail:mailOptions});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const call=(path,body,origin=mailOptions.publicOrigin)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
    const request=value();
    assert.equal((await call('/api/auth/registrations',request,'https://other.test')).status,403);
    assert.equal((await call('/api/auth/registrations?role=owner',request)).status,400);
    assert.equal((await fetch(base+'/api/auth/registrations')).status,401);
    const response=await call('/api/auth/registrations',request);assert.equal(response.status,202);
    assert.deepEqual(await response.json(),{accepted:true,delivery:'queued'});assert.equal(response.headers.get('set-cookie'),null);
    assert.equal((await call('/api/auth/registrations/resend',{requestId:request.requestId,email:request.email})).status,202);
    const delivery=await dispatch(db);assert(delivery.token);
    const verified=await call('/api/auth/registrations/verify',{token:delivery.token});assert.equal(verified.status,200);
    assert.deepEqual(await verified.json(),{completed:true,signInRequired:true,duplicate:false});assert.equal(verified.headers.get('set-cookie'),null);
    assert.equal((await call('/api/auth/registrations/verify',{token:delivery.token})).status,200);
    assert.equal((await call('/api/auth/registrations/verify',{token:'bad'})).status,400);
    assert.equal((await call('/api/auth/registrations',{...request,acceptTerms:false})).status,400);
    assert.equal((await call('/api/auth/registrations/verify?token=x',{token:delivery.token})).status,400);
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
  const demo=openDatabase(':memory:'),demoServer=createAppServer(demo,{tier:'local',aiMode:'synthetic',accessMode:'demo'});
  await new Promise(resolve=>demoServer.listen(0,'127.0.0.1',resolve));
  try {assert.equal((await fetch(`http://127.0.0.1:${demoServer.address().port}/api/auth/registrations`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);}
  finally {await new Promise(resolve=>demoServer.close(resolve));demo.close();}
});
