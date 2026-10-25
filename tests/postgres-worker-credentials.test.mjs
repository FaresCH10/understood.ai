import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {createPostgresRehearsalServer} from '../server/postgres/http.mjs';
import {provisionStaffCredential,requireSession} from '../server/postgres/auth.mjs';
import {createWorker} from '../server/postgres/people.mjs';
import {workerCompanyContext,workerCredentialStatus,issueWorkerCredentialSetup,completeWorkerSetup,authenticateWorker} from '../server/postgres/worker-credentials.mjs';
import {tokenHash} from '../server/auth-crypto.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';

const fetch=createSessionContextFetch();
const schema='understood_test_worker_credentials';
const options={schema};
const origin='http://127.0.0.1:3020';
const PASSWORD='synthetic worker password';
const owner={principal_type:'staff',principal_id:'owner',org_id:'alder',site_id:'alder',role:'owner'};
const auditor={...owner,principal_id:'auditor',role:'auditor'};
const harbor={principal_type:'staff',principal_id:'harbor',org_id:'harbor',site_id:'harbor',role:'owner'};
const request=(token)=>({headers:{cookie:`understood_session=${token}`}});

async function fixture(){
  const db=new PGlite();
  const client={async query(sql,values){return values?.length ? await db.query(sql,values) : (await db.exec(sql)).at(-1) || {rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
  await runMigrations(pool,options);
  await db.query("INSERT INTO organizations(id,name) VALUES ('alder','Alder Care'),('harbor','Harbor Care')");
  await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES ('alder','alder','A','UTC'),('alder-north','alder','C','UTC'),('harbor','harbor','B','UTC')");
  await db.query(`INSERT INTO staff(id,org_id,site_id,name,role) VALUES ('owner','alder','alder','Owner','owner'),
    ('auditor','alder','alder','Auditor','auditor'),('harbor','harbor','harbor','Harbor','owner')`);
  await db.query("INSERT INTO workers(id,org_id,site_id,code,language) VALUES ('w1','alder','alder','001','en'),('w2','alder','alder','002','ur'),('wb','harbor','harbor','001','en')");
  return {db,pool};
}

const issue=(pool,workerId,expectedCode='Worker 040')=>issueWorkerCredentialSetup(pool,owner,workerId,{expectedCode,confirmed:true},options);
const claim=(pool,code,password=PASSWORD,remote='10.0.0.2')=>completeWorkerSetup(pool,{company:'alder',workerId:'worker 040',code,password},remote,options);

function memoryStorage(){
  const objects=new Map();
  return {objects,async save(row,bytes){objects.set(row.id,Buffer.from(bytes));},async read(row){return objects.get(row.id);},async remove(row){objects.delete(row.id);}};
}

async function withHttp(f,run){
  const server=createPostgresRehearsalServer(f.pool,{...options,tier:'local',aiMode:'synthetic',accessMode:'credential',
    publicOrigin:origin,dataClass:'synthetic',storage:memoryStorage()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,cookie,init={})=>{
    const headers={origin,'content-type':'application/json',...(cookie?{cookie}:{}),...init.headers};
    if(cookie && (init.method==='POST' && path.startsWith('/worker/') || path.startsWith('/clarifications')) && !Object.hasOwn(headers,'x-client-session-context')){
      const session=await (await fetch(`${base}/api/session`,{headers:{cookie}})).json();
      headers['x-client-session-context']=session.clientContext || '';
    }
    return fetch(`${base}/api${path}`,{...init,headers});
  };
  try{await run({request,base});}finally{await new Promise(resolve=>server.close(resolve));}
}
const cookieOf=(response)=>response.headers.get('set-cookie').split(';')[0];
const post=(body)=>({method:'POST',body:JSON.stringify(body)});

test('PostgreSQL worker setup, activation, login and revision fencing stay scoped and generic',async()=>{
  const f=await fixture(),{db,pool}=f;
  try{
    assert.deepEqual(await workerCompanyContext(pool,{company:' ALDER '},options),{company:{id:'alder',name:'Alder Care'}});
    await assert.rejects(workerCompanyContext(pool,{company:'missing'},options),/Company not found/);
    await assert.rejects(workerCompanyContext(pool,{company:'alder',extra:1},options),/Invalid input/);
    const created=await createWorker(pool,owner,{code:'Worker 040',name:'Nadia Fares',language:'en'},options);
    const initial=await workerCredentialStatus(pool,owner,created.id,options);
    assert.equal(initial.state,'none');assert.equal(initial.loginId,'WORKER 040');assert.equal(initial.credentialRevision,0);
    assert.equal(initial.setupAvailable,false);
    await assert.rejects(issueWorkerCredentialSetup(pool,auditor,created.id,{expectedCode:'Worker 040',confirmed:true},options),/Forbidden/);
    await assert.rejects(issueWorkerCredentialSetup(pool,owner,'wb',{expectedCode:'Worker 040',confirmed:true},options),/Worker unavailable/);
    await assert.rejects(issueWorkerCredentialSetup(pool,owner,created.id,{expectedCode:'Worker 999',confirmed:true},options),/Worker code changed/);
    await assert.rejects(issueWorkerCredentialSetup(pool,owner,created.id,{expectedCode:'Worker 040',confirmed:false},options),/Confirmation/);
    const issued=await issue(pool,created.id);
    assert.match(issued.setupCode,/^[A-Za-z0-9_-]{43}$/);assert.equal(issued.state,'setup');assert.equal(issued.credentialRevision,1);
    assert.equal((await db.query('SELECT token_hash FROM worker_setup_tokens WHERE worker_id=$1',[created.id])).rows[0].token_hash,tokenHash(issued.setupCode));
    const status=await workerCredentialStatus(pool,owner,created.id,options);
    assert.equal(status.setupAvailable,true);assert.ok(!JSON.stringify(status).includes(issued.setupCode));
    await assert.rejects(claim(pool,'a'.repeat(43)),/Invalid or expired setup code/);
    assert.equal((await db.query('SELECT state FROM worker_credentials WHERE worker_id=$1',[created.id])).rows[0].state,'setup');
    const session=await claim(pool,issued.setupCode);
    const stored=(await db.query('SELECT state,password_salt,password_hash,credential_revision FROM worker_credentials WHERE worker_id=$1',[created.id])).rows[0];
    assert.equal(stored.state,'active');assert.match(stored.password_salt,/^[0-9a-f]{32}$/);assert.match(stored.password_hash,/^[0-9a-f]{128}$/);
    assert.equal(stored.credential_revision,2);
    assert.equal((await db.query('SELECT credential_revision FROM sessions WHERE token_hash=$1',[tokenHash(session.token)])).rows[0].credential_revision,2);
    assert.equal((await requireSession(pool,request(session.token),options)).id,created.id);
    assert.equal((await workerCredentialStatus(pool,owner,created.id,options)).state,'active');
    await assert.rejects(claim(pool,issued.setupCode),/Invalid or expired setup code/);
    const signed=await authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:PASSWORD},'10.0.0.4',options);
    assert.equal((await db.query('SELECT credential_revision FROM sessions WHERE token_hash=$1',[tokenHash(signed.token)])).rows[0].credential_revision,2);
    await assert.rejects(authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:'wrong synthetic password'},'10.0.0.5',options),/Invalid credentials/);
    await assert.rejects(authenticateWorker(pool,{company:'harbor',workerId:'worker 040',password:PASSWORD},'10.0.0.6',options),/Invalid credentials/);
    await assert.rejects(authenticateWorker(pool,{company:'alder',workerId:'worker 041',password:PASSWORD},'10.0.0.7',options),/Invalid credentials/);
    await db.query('UPDATE worker_credentials SET credential_revision=credential_revision+1 WHERE worker_id=$1',[created.id]);
    await assert.rejects(requireSession(pool,request(session.token),options),/Sign in required/);
    await assert.rejects(db.query(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode,credential_revision)
      VALUES($1,'alder','alder','worker',$2,clock_timestamp()+interval '1 hour',NULL,NULL,'credential',2)`,['f'.repeat(64),created.id]),/Scope mismatch/);
    await assert.rejects(db.query(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode,credential_revision)
      VALUES($1,'alder','alder','worker',$2,clock_timestamp()+interval '1 hour',NULL,NULL,'credential',NULL)`,['e'.repeat(64),created.id]),/violates check constraint/i);
    const fresh=await authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:PASSWORD},'10.0.0.8',options);
    assert.equal((await db.query('SELECT credential_revision FROM sessions WHERE token_hash=$1',[tokenHash(fresh.token)])).rows[0].credential_revision,3);
    await assert.rejects(db.query("UPDATE worker_credentials SET password_hash=repeat('0',128) WHERE worker_id=$1",[created.id]),/requires setup/);
    await assert.rejects(db.query("UPDATE worker_credentials SET org_id='b' WHERE worker_id=$1",[created.id]),/identity is immutable/);
    await assert.rejects(db.query('UPDATE worker_credentials SET credential_revision=1 WHERE worker_id=$1',[created.id]),/cannot decrease/);
    const tokenRow=(await db.query('SELECT id,used_at FROM worker_setup_tokens WHERE worker_id=$1',[created.id])).rows[0];
    assert.ok(tokenRow.used_at);
    await assert.rejects(db.query('UPDATE worker_setup_tokens SET used_at=NULL WHERE id=$1',[tokenRow.id]),/immutable/);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM audit WHERE action IN ('worker.credential_setup_issued','worker.credential_activated','worker.signed_in')")).rows[0].n,4);
  }finally{await db.close();}
});

test('PostgreSQL reset revokes sessions, codes and grants and rotates the password',async()=>{
  const f=await fixture(),{db,pool}=f;
  try{
    const created=await createWorker(pool,owner,{code:'Worker 040',name:'Nadia Fares',language:'en'},options);
    const first=await issue(pool,created.id);
    const session=await claim(pool,first.setupCode);
    await db.query(`INSERT INTO worker_grants(id,org_id,site_id,worker_id,token_hash,expires_at,redeemed_at,revoked_at,created_at)
      VALUES('g1','alder','alder',$1,$2,clock_timestamp()+interval '1 hour',clock_timestamp(),NULL,clock_timestamp())`,[created.id,tokenHash('synthetic grant token')]);
    const second=await issue(pool,created.id);
    assert.notEqual(second.setupCode,first.setupCode);
    assert.equal(second.credentialRevision,3);
    assert.equal((await db.query('SELECT state,password_salt FROM worker_credentials WHERE worker_id=$1',[created.id])).rows[0].state,'setup');
    assert.equal((await db.query('SELECT state FROM worker_credentials WHERE worker_id=$1',[created.id])).rows[0].state,'setup');
    assert.ok((await db.query('SELECT revoked_at FROM sessions WHERE token_hash=$1',[tokenHash(session.token)])).rows[0].revoked_at);
    assert.ok((await db.query("SELECT revoked_at FROM worker_grants WHERE id='g1'")).rows[0].revoked_at);
    await assert.rejects(claim(pool,first.setupCode),/Invalid or expired setup code/);
    const renewed=await claim(pool,second.setupCode,'replacement synthetic password','10.1.0.3');
    assert.equal((await db.query('SELECT credential_revision FROM sessions WHERE token_hash=$1',[tokenHash(renewed.token)])).rows[0].credential_revision,4);
    await assert.rejects(authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:PASSWORD},'10.1.0.4',options),/Invalid credentials/);
    assert.equal((await authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:'replacement synthetic password'},'10.1.0.5',options)).workerId,created.id);
    await db.query('UPDATE workers SET active=false WHERE id=$1',[created.id]);
    await assert.rejects(authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:'replacement synthetic password'},'10.1.0.6',options),/Invalid credentials/);
  }finally{await db.close();}
});

test('PostgreSQL eight failed worker passwords deny the correct password until the window clears',async()=>{
  const f=await fixture(),{db,pool}=f;
  try{
    const created=await createWorker(pool,owner,{code:'Worker 040',name:'Nadia Fares',language:'en'},options);
    const issued=await issue(pool,created.id);
    await claim(pool,issued.setupCode);
    for(let n=0;n<8;n++)
      await assert.rejects(authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:'incorrect synthetic password'},`10.2.1.${n}`,options),/Invalid credentials/);
    await assert.rejects(authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:PASSWORD},'10.2.2.1',options),/Invalid credentials/);
    await db.query('DELETE FROM auth_attempts');
    assert.equal((await authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:PASSWORD},'10.2.2.2',options)).workerId,created.id);
  }finally{await db.close();}
});

test('PostgreSQL paused site and disabled worker fail closed for password and setup routes',async()=>{
  const f=await fixture(),{db,pool}=f;
  try{
    const created=await createWorker(pool,owner,{code:'Worker 040',name:'Nadia Fares',language:'en'},options);
    const active=await issue(pool,created.id);const session=await claim(pool,active.setupCode);
    await db.query("INSERT INTO site_access_controls(site_id,org_id,revision,state,reason,updated_at) VALUES('alder','alder',1,'paused','operational',clock_timestamp())");
    await assert.rejects(authenticateWorker(pool,{company:'alder',workerId:'worker 040',password:PASSWORD},'10.3.0.1',options),/Invalid credentials/);
    await assert.rejects(requireSession(pool,request(session.token),options),/Worker access paused/);
    await assert.rejects(issue(pool,created.id),/Worker access paused/);
    await db.query("DELETE FROM site_access_controls WHERE site_id='alder'");
    const issued=await issue(pool,created.id);
    await db.query('UPDATE workers SET active=false WHERE id=$1',[created.id]);
    await assert.rejects(claim(pool,issued.setupCode,PASSWORD,'10.3.0.2'),/Invalid or expired setup code/);
    assert.equal((await workerCredentialStatus(pool,owner,created.id,options)).workerActive,false);
  }finally{await db.close();}
});

test('PostgreSQL worker credential HTTP routes issue codes once, set cookies and fence resets',async()=>{
  const f=await fixture(),{pool}=f;
  try{
    const staffPassword='a long synthetic staff password';
    await provisionStaffCredential(pool,{staffId:'owner',orgId:'alder',siteId:'alder',email:'owner@example.test',password:staffPassword},options);
    const created=await createWorker(pool,owner,{code:'Worker 040',name:'Nadia Fares',language:'en'},options);
    await withHttp(f,async({request,base})=>{
      const staff=cookieOf(await request('/auth/staff/login',null,post({email:'owner@example.test',password:staffPassword})));
      const context=await request('/auth/worker/context?company=ALDER');
      assert.equal(context.status,200);assert.deepEqual((await context.json()).company,{id:'alder',name:'Alder Care'});
      assert.equal((await request('/auth/worker/context?company=missing')).status,404);
      assert.equal((await request('/auth/worker/context?company=alder&extra=1')).status,400);
      assert.equal((await request('/auth/worker/login?x=1',null,post({company:'alder',workerId:'worker 040',password:PASSWORD}))).status,400);
      assert.equal((await request(`/people/workers/${created.id}/credentials`)).status,401);
      assert.equal((await request('/people/workers/wb/credentials',staff)).status,404);
      assert.equal((await request(`/people/workers/${created.id}/credentials/setup`,staff,post({expectedCode:'Worker 040',confirmed:false}))).status,400);
      const createdResponse=await request(`/people/workers/${created.id}/credentials/setup`,staff,post({expectedCode:'Worker 040',confirmed:true,expiresInMinutes:30}));
      assert.equal(createdResponse.status,201);
      const issued=await createdResponse.json();
      assert.match(issued.setupCode,/^[A-Za-z0-9_-]{43}$/);
      const wrong=await request('/auth/worker/setup',null,post({company:'alder',workerId:'worker 040',code:'b'.repeat(43),password:PASSWORD}));
      assert.equal(wrong.status,401);assert.deepEqual(await wrong.json(),{error:'Invalid or expired setup code'});
      const claimed=await request('/auth/worker/setup',null,post({company:'alder',workerId:'worker 040',code:issued.setupCode,password:PASSWORD}));
      assert.equal(claimed.status,200);assert.match(claimed.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
      const workerCookie=cookieOf(claimed);
      assert.equal((await request('/worker/briefings',workerCookie)).status,200);
      assert.equal((await request(`/people/workers/${created.id}/credentials`,workerCookie)).status,403);
      const session=await (await request('/session',workerCookie)).json();
      assert.equal(session.authenticated,true);assert.equal(session.role,'worker');assert.match(session.clientContext,/^[a-f0-9]{64}$/);
      assert.equal((await request('/auth/worker/login',null,post({company:'alder',workerId:'worker 040',password:PASSWORD}))).status,200);
      assert.equal((await request('/auth/worker/login',null,post({company:'alder',workerId:'worker 040',password:'wrong synthetic password'}))).status,401);
      const reset=await request(`/people/workers/${created.id}/credentials/setup`,staff,post({expectedCode:'Worker 040',confirmed:true}));
      assert.equal(reset.status,201);
      assert.equal((await request('/worker/briefings',workerCookie)).status,401);
      const status=await (await request(`/people/workers/${created.id}/credentials`,staff)).json();
      assert.equal(status.state,'setup');assert.equal(status.setupAvailable,true);
      assert.ok(!JSON.stringify(status).includes(issued.setupCode));
      assert.equal((await request('/people/workers/wb/credentials/setup',staff,post({expectedCode:'001',confirmed:true}))).status,404);
    });
  }finally{await f.db.close();}
});
