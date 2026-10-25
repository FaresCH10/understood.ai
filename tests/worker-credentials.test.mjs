import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {createAppServer} from '../server/index.mjs';
import {provisionStaffCredential} from '../server/auth.mjs';
import {tokenHash} from '../server/auth-crypto.mjs';
import {workerCompanyContext,workerCredentialStatus,issueWorkerCredentialSetup,completeWorkerSetup,authenticateWorker} from '../server/worker-credentials.mjs';
import {workerLoginInput,workerSetupClaimInput,credentialSetupInput,normalizeWorkerLogin} from '../server/worker-credentials-input.mjs';
import {createSessionContextFetch} from './helpers/session-http.mjs';

const fetch=createSessionContextFetch();
const origin='http://127.0.0.1:3020';
const options={tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:origin};
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
const PASSWORD='synthetic worker password';

function withDb(run) {
  const db=openDatabase(':memory:');
  try { seed(db); return run(db); }
  finally { db.close(); }
}

async function withServer(run) {
  const db=openDatabase(':memory:');seed(db);
  const server=createAppServer(db,options);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,cookie,opts={})=>fetch(`${base}/api${path}`,{...opts,
    headers:{origin,...(cookie?{cookie}:{}),'content-type':'application/json',...opts.headers}});
  try { await run({db,request}); }
  finally { await new Promise(resolve=>server.close(resolve));db.close(); }
}

function setup(db,workerId='worker-14',code='Worker 014') {
  return issueWorkerCredentialSetup(db,owner,workerId,{expectedCode:code,confirmed:true});
}

test('credential input rejects ambiguous identifiers and weak claims',()=>{
  for(const input of [null,[],{company:'cedar',workerId:'worker-1'},{company:'cedar',workerId:'-'},
    {company:'cedar',workerId:'',password:PASSWORD},{company:'cedar',workerId:'x',password:PASSWORD},
    {company:'cedar',workerId:'worker-1',password:PASSWORD,extra:true}]) assert.throws(()=>workerLoginInput(input),/Invalid/);
  assert.deepEqual(workerLoginInput({company:' CEDAR ',workerId:' worker-014 ',password:PASSWORD}),
    {company:'cedar',login:'WORKER-014',password:PASSWORD});
  assert.equal(normalizeWorkerLogin(' worker 014 '),'WORKER 014');
  for(const input of [{company:'cedar',workerId:'worker-1',code:'short',password:PASSWORD},
    {company:'cedar',workerId:'worker-1',code:'a'.repeat(43),password:PASSWORD,confirmed:true}]) assert.throws(()=>workerSetupClaimInput(input),/Invalid/);
  assert.throws(()=>credentialSetupInput({expectedCode:'Worker 014',confirmed:false}),/Confirmation/);
  assert.throws(()=>credentialSetupInput({expectedCode:'Worker 014',confirmed:true,expiresInMinutes:1.5}),/Invalid setup expiry/);
  assert.equal(credentialSetupInput({expectedCode:' Worker 014 ',confirmed:true}).expiresInMinutes,60);
});

test('setup, activation, login and out-of-band revision fencing stay scoped and generic',()=>withDb(db=>{
  assert.deepEqual(workerCompanyContext(db,{company:'CEDAR'}).company,{id:'cedar',name:'Cedar Works'});
  assert.throws(()=>workerCompanyContext(db,{company:'missing'}),/Company not found/);
  assert.throws(()=>workerCompanyContext(db,{company:'cedar',extra:1}),/Invalid input/);
  const initial=workerCredentialStatus(db,owner,'worker-14');
  assert.equal(initial.state,'none');assert.equal(initial.loginId,'WORKER 014');assert.equal(initial.credentialRevision,0);
  assert.throws(()=>issueWorkerCredentialSetup(db,owner,'worker-14',{expectedCode:'Worker 014',confirmed:false}),/Confirmation/);
  assert.throws(()=>issueWorkerCredentialSetup(db,{...owner,role:'auditor'},'worker-14',{expectedCode:'Worker 014',confirmed:true}),/Forbidden/);
  assert.throws(()=>issueWorkerCredentialSetup(db,owner,'harbor-worker',{expectedCode:'Worker 014',confirmed:true}),/Worker unavailable/);
  assert.throws(()=>issueWorkerCredentialSetup(db,owner,'worker-14',{expectedCode:'Worker 999',confirmed:true}),/Worker code changed/);
  const issued=setup(db);
  assert.match(issued.setupCode,/^[A-Za-z0-9_-]{43}$/);assert.equal(issued.loginId,'WORKER 014');assert.equal(issued.state,'setup');
  assert.equal(db.prepare('SELECT token_hash FROM worker_setup_tokens WHERE worker_id=?').get('worker-14').token_hash,tokenHash(issued.setupCode));
  assert.ok(!JSON.stringify(workerCredentialStatus(db,owner,'worker-14')).includes(issued.setupCode));
  assert.equal(workerCredentialStatus(db,owner,'worker-14').setupAvailable,true);
  assert.throws(()=>completeWorkerSetup(db,{company:'cedar',workerId:'worker 014',code:'a'.repeat(43),password:PASSWORD},'10.0.0.1'),/Invalid or expired setup code/);
  assert.equal(db.prepare("SELECT state FROM worker_credentials WHERE worker_id='worker-14'").get().state,'setup');
  const session=completeWorkerSetup(db,{company:'cedar',workerId:'worker 014',code:issued.setupCode,password:PASSWORD},'10.0.0.2');
  const stored=db.prepare('SELECT state,password_salt,password_hash,credential_revision FROM worker_credentials WHERE worker_id=?').get('worker-14');
  assert.equal(stored.state,'active');assert.match(stored.password_salt,/^[0-9a-f]{32}$/);assert.match(stored.password_hash,/^[0-9a-f]{128}$/);
  assert.equal(stored.credential_revision,2);
  assert.equal(db.prepare('SELECT credential_revision FROM sessions WHERE token_hash=?').get(tokenHash(session.token)).credential_revision,2);
  assert.equal(workerCredentialStatus(db,owner,'worker-14').state,'active');
  assert.throws(()=>completeWorkerSetup(db,{company:'cedar',workerId:'worker 014',code:issued.setupCode,password:'another synthetic password'},'10.0.0.3'),/Invalid or expired setup code/);
  const signed=authenticateWorker(db,{company:'cedar',workerId:'worker 014',password:PASSWORD},'10.0.0.4');
  assert.equal(db.prepare('SELECT credential_revision FROM sessions WHERE token_hash=?').get(tokenHash(signed.token)).credential_revision,2);
  assert.throws(()=>authenticateWorker(db,{company:'cedar',workerId:'worker 015',password:PASSWORD},'10.0.0.5'),/Invalid credentials/);
  assert.throws(()=>authenticateWorker(db,{company:'harbor',workerId:'worker 014',password:PASSWORD},'10.0.0.6'),/Invalid credentials/);
  assert.throws(()=>authenticateWorker(db,{company:'cedar',workerId:'worker 014',password:'wrong synthetic password'},'10.0.0.7'),/Invalid credentials/);
  db.prepare("UPDATE worker_credentials SET credential_revision=credential_revision+1 WHERE worker_id='worker-14'").run();
  assert.throws(()=>db.prepare(`INSERT INTO sessions
    (token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode,credential_revision)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('forged', 'cedar','beirut','worker','worker-14',new Date(Date.now()+10000).toISOString(),null,null,'credential',2),/Scope mismatch/);
  assert.throws(()=>db.prepare("UPDATE worker_credentials SET password_hash=? WHERE worker_id='worker-14'").run('0'.repeat(128)),/requires setup/);
  assert.throws(()=>db.prepare("UPDATE worker_credentials SET org_id='harbor' WHERE worker_id='worker-14'").run(),/immutable/);
  assert.throws(()=>db.prepare("UPDATE worker_credentials SET credential_revision=1 WHERE worker_id='worker-14'").run(),/cannot decrease/);
}));

test('reset revokes every prior session and code without touching the credential schema',()=>withDb(db=>{
  const first=setup(db);
  const session=completeWorkerSetup(db,{company:'cedar',workerId:'worker 014',code:first.setupCode,password:PASSWORD},'10.1.0.1');
  db.prepare("INSERT INTO worker_grants VALUES(?,?,?,?,?,?,?,?,?)").run('credential-grant','cedar','beirut','worker-14',
    tokenHash('synthetic grant'),'2099-01-01T00:00:00.000Z',null,null,'2026-01-01T00:00:00.000Z');
  const second=issueWorkerCredentialSetup(db,owner,'worker-14',{expectedCode:'Worker 014',confirmed:true});
  assert.notEqual(second.setupCode,first.setupCode);
  assert.equal(db.prepare('SELECT state,password_salt FROM worker_credentials WHERE worker_id=?').get('worker-14').state,'setup');
  assert.equal(db.prepare('SELECT revoked_at FROM sessions WHERE token_hash=?').get(tokenHash(session.token)).revoked_at!==null,true);
  assert.notEqual(db.prepare("SELECT revoked_at FROM worker_grants WHERE id='credential-grant'").get().revoked_at,null);
  assert.throws(()=>completeWorkerSetup(db,{company:'cedar',workerId:'worker 014',code:first.setupCode,password:PASSWORD},'10.1.0.2'),/Invalid or expired setup code/);
  const renewed=completeWorkerSetup(db,{company:'cedar',workerId:'worker 014',code:second.setupCode,password:'replacement synthetic password'},'10.1.0.3');
  assert.equal(db.prepare('SELECT credential_revision FROM sessions WHERE token_hash=?').get(tokenHash(renewed.token)).credential_revision,4);
  assert.throws(()=>authenticateWorker(db,{company:'cedar',workerId:'worker 014',password:PASSWORD},'10.1.0.4'),/Invalid credentials/);
  assert.equal(authenticateWorker(db,{company:'cedar',workerId:'worker 014',password:'replacement synthetic password'},'10.1.0.5').workerId,'worker-14');
  db.prepare("UPDATE workers SET active=0 WHERE id='worker-14'").run();
  assert.throws(()=>authenticateWorker(db,{company:'cedar',workerId:'worker 014',password:'replacement synthetic password'},'10.1.0.6'),/Invalid credentials/);
}));

test('eight failed attempts deny even the correct worker password until the window clears',()=>withDb(db=>{
  const issued=setup(db,'worker-15','Worker 015');
  completeWorkerSetup(db,{company:'cedar',workerId:'worker 015',code:issued.setupCode,password:PASSWORD},'10.2.0.1');
  for(let n=0;n<8;n++) assert.throws(()=>authenticateWorker(db,{company:'cedar',workerId:'worker 015',password:'incorrect synthetic password'},`10.2.1.${n}`),/Invalid credentials/);
  assert.throws(()=>authenticateWorker(db,{company:'cedar',workerId:'worker 015',password:PASSWORD},'10.2.2.1'),/Invalid credentials/);
  db.prepare('DELETE FROM auth_attempts').run();
  assert.equal(authenticateWorker(db,{company:'cedar',workerId:'worker 015',password:PASSWORD},'10.2.2.2').workerId,'worker-15');
}));

test('paused site and disabled worker fail closed for password and setup routes',()=>withDb(db=>{
  db.prepare("INSERT INTO site_access_controls(site_id,org_id,revision,state,reason,updated_at) VALUES('beirut','cedar',1,'paused','operational','2026-01-01T00:00:00.000Z')").run();
  assert.throws(()=>setup(db),/Worker access paused/);
  db.prepare("DELETE FROM site_access_controls WHERE site_id='beirut'").run();
  const issued=setup(db);
  db.prepare("UPDATE workers SET active=0 WHERE id='worker-14'").run();
  assert.throws(()=>completeWorkerSetup(db,{company:'cedar',workerId:'worker 014',code:issued.setupCode,password:PASSWORD},'10.3.0.1'),/Invalid or expired setup code/);
  assert.equal(workerCredentialStatus(db,owner,'worker-14').workerActive,false);
}));

test('HTTP routes require verified staff, exact input and set credential cookies without exposing codes', async()=>{
  await withServer(async({db,request})=>{
    provisionStaffCredential(db,'maya','maya@example.test','a long local test password');
    const staffCookie=(await request('/auth/staff/login',null,{method:'POST',body:JSON.stringify({email:'maya@example.test',password:'a long local test password'})})).headers.get('set-cookie').split(';')[0];
    const context=await request('/auth/worker/context?company=CEDAR');
    assert.equal(context.status,200);assert.deepEqual((await context.json()).company,{id:'cedar',name:'Cedar Works'});
    assert.equal((await request('/auth/worker/context?company=missing')).status,404);
    assert.equal((await request('/auth/worker/context?company=cedar&extra=1')).status,400);
    assert.equal((await request('/auth/worker/login?x=1',null,{method:'POST',body:JSON.stringify({company:'cedar',workerId:'worker 014',password:PASSWORD})})).status,400);
    assert.equal((await request('/people/workers/worker-14/credentials')).status,401);
    assert.equal((await request('/people/workers/harbor-worker/credentials',staffCookie)).status,404);
    const issued=await request('/people/workers/worker-14/credentials/setup',staffCookie,{method:'POST',body:JSON.stringify({expectedCode:'Worker 014',confirmed:false})});
    assert.equal(issued.status,400);
    const created=await request('/people/workers/worker-14/credentials/setup',staffCookie,{method:'POST',body:JSON.stringify({expectedCode:'Worker 014',confirmed:true,expiresInMinutes:30})});
    assert.equal(created.status,201);
    const code=(await created.json()).setupCode;assert.match(code,/^[A-Za-z0-9_-]{43}$/);
    const wrong=await request('/auth/worker/setup',null,{method:'POST',body:JSON.stringify({company:'cedar',workerId:'worker 014',code:'b'.repeat(43),password:PASSWORD})});
    assert.equal(wrong.status,401);assert.deepEqual(await wrong.json(),{error:'Invalid or expired setup code'});
    const claimed=await request('/auth/worker/setup',null,{method:'POST',body:JSON.stringify({company:'cedar',workerId:'worker 014',code,password:PASSWORD})});
    assert.equal(claimed.status,200);assert.match(claimed.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const workerCookie=claimed.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/worker/briefings',workerCookie)).status,200);
    assert.equal((await request('/people/workers/worker-14/credentials',workerCookie)).status,403);
    const session=await (await request('/session',workerCookie)).json();
    assert.equal(session.authenticated,true);assert.equal(session.role,'worker');assert.match(session.clientContext,/^[a-f0-9]{64}$/);
    assert.equal((await request('/auth/worker/login',null,{method:'POST',body:JSON.stringify({company:'cedar',workerId:'worker 014',password:PASSWORD})})).status,200);
    const reset=await request('/people/workers/worker-14/credentials/setup',staffCookie,{method:'POST',body:JSON.stringify({expectedCode:'Worker 014',confirmed:true})});
    assert.equal(reset.status,201);
    assert.equal((await request('/worker/briefings',workerCookie)).status,401);
  });
});
