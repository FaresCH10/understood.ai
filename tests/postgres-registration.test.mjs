import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {inSchema} from '../server/postgres/auth.mjs';
import {authenticateStaff,provisionStaffCredential} from '../server/postgres/auth.mjs';
import {entitlementState} from '../server/postgres/entitlements.mjs';
import {createWorker} from '../server/postgres/people.mjs';
import {requestRegistration,resendRegistration,verifyRegistration,expireRegistrations,processOneRegistration} from '../server/postgres/registration.mjs';
import {configureRuntimePermissions,verifyRuntimePermissions} from '../server/postgres/runtime-permissions.mjs';
import {openMail} from '../server/auth-mail.mjs';

const schema='understood_test_registration';
const options={schema};
const mail={available:true,key:Buffer.alloc(32,7),publicOrigin:'http://127.0.0.1:3140'};
const password='Synthetic-registration-password-123';
const email='new-owner@example.test';
const value=(override={})=>({requestId:randomUUID(),ownerName:'Synthetic Owner',email,password,companyName:'Synthetic Company',
  country:'US',phone:'+1 555 0100',acceptTerms:true,acceptPrivacy:true,...override});

async function fixture({failAudit=null}={}) {
  const db=new PGlite();let queue=Promise.resolve();
  const pool={async connect(){const previous=queue;let release;queue=new Promise(done=>{release=done;});await previous;
    return {release,async query(sql,values){
      if(failAudit?.id && sql.startsWith('INSERT INTO audit') && values?.includes(failAudit.id)) throw new Error('Injected registration audit failure');
      return values?.length ? db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};
    }};
  }};
  await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,options);
  const q=async(sql,values=[])=>(await db.query(sql,values)).rows;
  const request=override=>requestRegistration(pool,value(override),'127.0.0.1',mail,options);
  const dispatch=async(send)=>{let message;
    const processed=await processOneRegistration(pool,mail,{...options,send:async(config,id,payload)=>{
      message=payload;return send ? send(config,id,payload) : {providerId:'synthetic-registration'};
    }});
    return {processed,message,token:message?.text.match(/#verify-registration\/([A-Za-z0-9_-]{43})/)?.[1]};
  };
  const verify=token=>verifyRegistration(pool,{token},'127.0.0.1',mail,options);
  return {db,pool,q,request,dispatch,verify};
}

test('PostgreSQL registration verifies exactly one owner workspace with a fresh 14-day trial',async()=>{
  const f=await fixture();try{
    const input=value();
    assert.deepEqual(await f.request(input),{accepted:true,delivery:'queued'});
    assert.deepEqual(await f.request(input),{accepted:true,delivery:'queued'});
    const registration=(await f.q('SELECT * FROM organization_registrations'))[0];
    assert.equal(registration.state,'pending');assert.equal(registration.resend_count,0);
    assert.equal((await f.q('SELECT count(*)::int n FROM organization_registrations'))[0].n,1);
    assert.ok(!JSON.stringify(registration).includes(email));
    assert.equal((await f.q("SELECT count(*)::int n FROM registration_mail WHERE state='queued'"))[0].n,1);
    assert.equal((await f.q('SELECT count(*)::int n FROM registration_tokens'))[0].n,0);

    const delivery=await f.dispatch();
    assert.equal(delivery.processed,true);assert.match(delivery.message.text,/#verify-registration\/[A-Za-z0-9_-]{43}/);
    assert.equal(delivery.message.subject,'Verify your Understood account');
    assert.equal((await f.q("SELECT count(*)::int n FROM registration_mail WHERE state='sent' AND payload IS NULL"))[0].n,1);
    assert.equal((await f.q('SELECT count(*)::int n FROM registration_tokens'))[0].n,1);

    const replay=await f.verify(delivery.token);
    assert.deepEqual(replay,{completed:true,signInRequired:true,duplicate:false});
    assert.deepEqual(await f.verify(delivery.token),{completed:true,signInRequired:true,duplicate:true});
    await assert.rejects(f.verify('A'.repeat(43)),/Registration verification unavailable/);

    const [organization]=await f.q('SELECT id,name FROM organizations');
    assert.equal(organization.name,'Synthetic Company');
    const [site]=await f.q('SELECT id,org_id,name,timezone FROM sites');
    assert.deepEqual({id:site.id,org_id:site.org_id,name:site.name,timezone:site.timezone},{id:site.id,org_id:organization.id,name:'Synthetic Company',timezone:'UTC'});
    const [owner]=await f.q('SELECT id,org_id,site_id,name,role FROM staff');
    assert.deepEqual({id:owner.id,org_id:owner.org_id,site_id:owner.site_id,name:owner.name,role:owner.role},{id:owner.id,org_id:organization.id,site_id:site.id,name:'Synthetic Owner',role:'owner'});
    assert.deepEqual(await f.q('SELECT staff_id,email FROM staff_credentials'),[{staff_id:owner.id,email}]);
    assert.deepEqual(await f.q('SELECT staff_id,org_id,site_id FROM staff_account_memberships'),[{staff_id:owner.id,org_id:organization.id,site_id:site.id}]);
    assert.deepEqual(await f.q('SELECT org_id,revision,support_email FROM organization_settings'),[{org_id:organization.id,revision:0,support_email:email}]);
    assert.deepEqual(await f.q('SELECT site_id,org_id,revision,primary_contact_id FROM site_settings'),
      [{site_id:site.id,org_id:organization.id,revision:0,primary_contact_id:owner.id}]);
    const [entitlement]=await f.q('SELECT * FROM organization_entitlements');
    assert.equal(entitlement.state,'trial');assert.equal(entitlement.worker_limit,25);assert.equal(entitlement.plan,'trial');
    assert.equal(entitlement.revision,1);assert.equal(entitlement.updated_by,'registration');
    assert.equal(new Date(entitlement.ends_at)-new Date(entitlement.started_at),14*24*3600000);
    assert.deepEqual(await f.q('SELECT actor_type,actor_id,request_id,state,revision FROM organization_entitlement_transitions'),
      [{actor_type:'registration',actor_id:registration.id,request_id:registration.id,state:'trial',revision:1}]);
    assert.deepEqual(await f.q("SELECT actor_type,actor_id,action,object_id FROM audit"),[{actor_type:'system',actor_id:'registration',action:'organization.registered',object_id:registration.id}]);
    assert.equal((await f.q("SELECT count(*)::int n FROM sessions WHERE principal_type='staff'"))[0].n,0);
    assert.equal((await f.q('SELECT state,payload,org_id,site_id,owner_id FROM organization_registrations'))[0].state,'verified');
    const login=await authenticateStaff(f.pool,email,password,'127.0.0.1',options);
    assert.equal(login.principal.org_id,organization.id);
    assert.equal(login.principal.site_id,site.id);
    await assert.rejects(authenticateStaff(f.pool,email,'Synthetic-wrong-password-123','127.0.0.1',options),/Invalid credentials/);
    const endsAt=new Date(entitlement.ends_at).getTime();
    const trialAt=await inSchema(f.pool,schema,client=>entitlementState(client,organization.id,{now:endsAt-1}));
    assert.equal(trialAt.effectiveState,'trial');assert.equal(trialAt.writeAllowed,true);
    const expired=await inSchema(f.pool,schema,client=>entitlementState(client,organization.id,{now:endsAt}));
    assert.equal(expired.effectiveState,'read_only');assert.equal(expired.writeAllowed,false);
  }finally{await f.db.close();}
});

test('PostgreSQL resend rotates one-use links under the request and email binding',async()=>{
  const f=await fixture();try{
    const input=value();await f.request(input);
    const first=await f.dispatch();
    const remote=()=>randomBytes(6).toString('hex');
    assert.deepEqual(await resendRegistration(f.pool,{requestId:input.requestId,email:'other@example.test'},remote(),mail,options),
      {accepted:true,delivery:'queued'});
    assert.equal((await f.q('SELECT resend_count FROM organization_registrations'))[0].resend_count,0);
    await resendRegistration(f.pool,{requestId:input.requestId,email},remote(),mail,options);
    assert.equal((await f.q('SELECT resend_count FROM organization_registrations'))[0].resend_count,1);
    const second=await f.dispatch();
    assert.notEqual(first.token,second.token);
    await assert.rejects(f.verify(first.token),/Registration verification unavailable/);
    assert.equal((await f.q("SELECT count(*)::int n FROM registration_tokens WHERE revoked_at IS NOT NULL AND used_at IS NULL"))[0].n,1);

    let latest=second;
    for(let i=0;i<4;i++){await resendRegistration(f.pool,{requestId:input.requestId,email},remote(),mail,options);latest=await f.dispatch();}
    assert.equal((await f.q('SELECT resend_count FROM organization_registrations'))[0].resend_count,5);
    await resendRegistration(f.pool,{requestId:input.requestId,email},remote(),mail,options);
    assert.equal((await f.q("SELECT count(*)::int n FROM registration_mail WHERE state='queued'"))[0].n,0);
    assert.equal((await f.q("SELECT count(*)::int n FROM registration_mail WHERE state='sent'"))[0].n,6);
    assert.deepEqual(await f.verify(latest.token),{completed:true,signInRequired:true,duplicate:false});
  }finally{await f.db.close();}
});

test('PostgreSQL existing credentials and duplicate email requests stay generic without mail',async()=>{
  const f=await fixture();try{
    await f.q("INSERT INTO organizations(id,name) VALUES('a','A')");
    await f.q("INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','A','UTC')");
    await f.q("INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner')");
    await provisionStaffCredential(f.pool,{staffId:'owner',orgId:'a',siteId:'a',email,password},options);
    assert.deepEqual(await f.request(),{accepted:true,delivery:'queued'});
    assert.equal((await f.q('SELECT count(*)::int n FROM organization_registrations'))[0].n,0);
    assert.equal((await f.q('SELECT count(*)::int n FROM registration_mail'))[0].n,0);

    const input=value({email:'unique-owner@example.test'});await f.request(input);
    await f.request({...input,requestId:randomUUID(),companyName:'Another Company'});
    await f.request({...input,requestId:randomUUID(),email:'different-owner@example.test'});
    assert.equal((await f.q('SELECT count(*)::int n FROM organization_registrations'))[0].n,2);
    assert.equal((await f.q('SELECT count(*)::int n FROM registration_mail'))[0].n,2);
  }finally{await f.db.close();}
});

test('PostgreSQL expired registration links fail closed and re-registration does not reset the trial',async()=>{
  const f=await fixture();try{
    const first=value();await f.request(first);
    const delivery=await f.dispatch();
    await f.q("UPDATE organization_registrations SET expires_at=clock_timestamp()-interval '1 second'");
    await expireRegistrations(f.pool,options);
    assert.deepEqual((await f.q('SELECT state FROM organization_registrations'))[0],{state:'expired'});
    assert.deepEqual((await f.q('SELECT state,payload FROM registration_mail'))[0],{state:'sent',payload:null});
    assert.equal((await f.q('SELECT count(*)::int n FROM registration_tokens WHERE revoked_at IS NOT NULL'))[0].n,1);
    await assert.rejects(f.verify(delivery.token),/Registration verification unavailable/);

    const fresh=value();await f.request(fresh);
    assert.equal((await f.q('SELECT state,resend_count FROM organization_registrations'))[0].state,'pending');
    const retry=await f.dispatch();
    assert.deepEqual(await f.verify(retry.token),{completed:true,signInRequired:true,duplicate:false});
    const [entitlement]=await f.q('SELECT started_at,ends_at FROM organization_entitlements');
    const [registration]=await f.q('SELECT created_at FROM organization_registrations');
    assert.equal(new Date(entitlement.ends_at)-new Date(entitlement.started_at),14*24*3600000);
    assert.ok(new Date(entitlement.started_at)>=new Date(registration.created_at));
  }finally{await f.db.close();}
});

test('PostgreSQL verified trial permits 25 active workers across the company and blocks the 26th',async()=>{
  const f=await fixture();try{
    await f.request();const delivery=await f.dispatch();await f.verify(delivery.token);
    const [owner]=await f.q('SELECT id,org_id,site_id,role FROM staff');
    const session={principal_type:'staff',principal_id:owner.id,org_id:owner.org_id,site_id:owner.site_id,role:'owner',access_mode:'credential'};
    for(let i=1;i<=25;i++)await createWorker(f.pool,session,{code:`CAP-${String(i).padStart(3,'0')}`,language:'en'},options);
    assert.equal((await f.q('SELECT count(*)::int n FROM workers'))[0].n,25);
    await assert.rejects(createWorker(f.pool,session,{code:'CAP-026',language:'en'},options),/Worker capacity reached/);
    assert.equal((await f.q('SELECT count(*)::int n FROM workers'))[0].n,25);
  }finally{await f.db.close();}
});

test('PostgreSQL application runtime verifies registration but cannot alter the trial it inserts',async()=>{
  const f=await fixture(),role='understood_registration_app';try{
    await f.db.exec(`CREATE ROLE ${role} LOGIN`);
    await configureRuntimePermissions(f.pool,{...options,role,profile:'application',dedicatedDatabase:true,writersStopped:true});
    await f.db.exec(`SET SESSION AUTHORIZATION ${role}`);
    assert.equal((await verifyRuntimePermissions(f.pool,{...options,profile:'application'})).profile,'application');
    await f.request();const delivery=await f.dispatch();
    assert.deepEqual(await f.verify(delivery.token),{completed:true,signInRequired:true,duplicate:false});
    assert.equal((await f.q('SELECT count(*)::int n FROM organization_entitlements'))[0].n,1);
    await assert.rejects(f.q("UPDATE organization_entitlements SET state='active',ends_at=NULL,revision=revision+1"),error=>error.code==='42501');
    await assert.rejects(f.q('DELETE FROM organization_entitlements'),error=>error.code==='42501');
    await assert.rejects(f.q("INSERT INTO organization_entitlement_transitions SELECT org_id,2,'active',started_at,NULL,25,'trial',NULL,'x','system','x',NULL,started_at FROM organization_entitlements"),/Entitlement transition scope mismatch/);
    await assert.rejects(f.q("UPDATE organization_entitlement_transitions SET state='active'"),error=>error.code==='42501');
    await assert.rejects(f.q('DELETE FROM organization_entitlement_transitions'),error=>error.code==='42501');
  }finally{await f.db.close();}
});

test('PostgreSQL failed audit rolls the whole verified workspace back',async()=>{
  const failAudit={id:null};
  const f=await fixture({failAudit});try{
    await f.request();const delivery=await f.dispatch();
    const [registration]=await f.q('SELECT id FROM organization_registrations');
    failAudit.id=registration.id;
    await assert.rejects(f.verify(delivery.token),/Injected registration audit failure/);
    assert.equal((await f.q('SELECT count(*)::int n FROM organizations'))[0].n,0);
    assert.equal((await f.q('SELECT count(*)::int n FROM staff'))[0].n,0);
    assert.equal((await f.q('SELECT count(*)::int n FROM organization_entitlements'))[0].n,0);
    assert.equal((await f.q("SELECT count(*)::int n FROM registration_tokens WHERE used_at IS NULL AND revoked_at IS NULL"))[0].n,1);
    assert.deepEqual((await f.q('SELECT state FROM organization_registrations'))[0],{state:'pending'});
    assert.equal((await f.q('SELECT count(*)::int n FROM staff_credentials'))[0].n,0);
  }finally{await f.db.close();}
});
