import {assignWorkerPassword} from '../server/worker-credentials.mjs';
import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { createAppServer } from '../server/index.mjs';
import { createSession, provisionStaffCredential,authenticateStaff,issueWorkerGrant,revokeWorkerGrant,redeemWorkerGrant,listWorkerGrants,grantIssueInput,grantFilters } from '../server/auth.mjs';
import { tokenHash } from '../server/auth-crypto.mjs';
import {AUTH_GLOBAL_KEY,AUTH_GLOBAL_LIMIT} from '../server/auth-budget.mjs';

const origin = 'http://127.0.0.1:3020';
const credentialOptions = { tier: 'local', aiMode: 'synthetic', accessMode: 'credential', publicOrigin: origin };

async function withServer(run) {
  const db = openDatabase(':memory:');
  seed(db);
  const server = createAppServer(db, credentialOptions);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, cookie, options = {}) => fetch(`${base}/api${path}`, {
    ...options,
    headers: { origin, ...(cookie ? { cookie } : {}), 'content-type': 'application/json', ...options.headers },
  });
  try { await run({ db, request }); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

async function login(request, email, password) {
  return request('/auth/staff/login', null, { method: 'POST', body: JSON.stringify({ email, password }) });
}

test('SQLite successful login preserves IP failures and global admission denies even valid credentials',()=>{
  const db=openDatabase(':memory:');try {
    seed(db);const password='synthetic-login-budget-password';provisionStaffCredential(db,'maya','maya@example.test',password);
    assert.throws(()=>authenticateStaff(db,'unknown@example.test',password,'shared-ip'),/Invalid credentials/);
    assert.equal(authenticateStaff(db,'maya@example.test',password,'shared-ip').id,'maya');
    assert.equal(db.prepare('SELECT count FROM auth_attempts WHERE key_hash=?').get(tokenHash('ip:shared-ip')).count,1);
    db.prepare('UPDATE auth_attempts SET count=? WHERE key_hash=?').run(AUTH_GLOBAL_LIMIT,AUTH_GLOBAL_KEY);
    const before=JSON.stringify(db.prepare('SELECT * FROM auth_attempts ORDER BY key_hash').all());
    assert.throws(()=>authenticateStaff(db,'maya@example.test',password,'fresh-ip'),/Invalid credentials/);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM auth_attempts ORDER BY key_hash').all()),before);
  }finally {db.close();}
});

test('startup requires explicit local modes and never exposes synthetic workflow as production', () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(() => createAppServer(db), /UNDERSTOOD_TIER=local/);
    assert.throws(() => createAppServer(db, { tier: 'production', aiMode: 'live', accessMode: 'credential', publicOrigin: 'https://example.test' }), /Production startup blocked/);
    assert.throws(() => createAppServer(db, { tier: 'local', aiMode: 'live', accessMode: 'credential' }), /UNDERSTOOD_TIER=local/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n, 0);
  } finally { db.close(); }
});

test('credential mode denies demo profile, checks origin and uses generic throttled staff login', async () => {
  await withServer(async ({ db, request }) => {
    provisionStaffCredential(db, 'maya', 'maya@example.test', 'a long local test password');
    assert.equal((await request('/demo/session', null, { method: 'POST', body: '{}' })).status, 404);
    const demoToken = createSession(db, { id: 'maya', org_id: 'cedar', site_id: 'beirut' }, 'staff', 'demo').token;
    assert.equal((await request('/overview', `understood_session=${demoToken}`)).status, 401);
    const missing = await login(request, 'nobody@example.test', 'wrong password');
    const wrong = await login(request, 'maya@example.test', 'wrong password');
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), await wrong.json());
    const noOrigin = await fetch(`http://127.0.0.1:${new URL(wrong.url).port}/api/auth/staff/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'maya@example.test', password: 'a long local test password' }),
    });
    assert.equal(noOrigin.status, 403);
    for (let n = 0; n < 3; n++) assert.equal((await login(request, 'maya@example.test', 'wrong password')).status, 401);
    assert.equal((await login(request, 'maya@example.test', 'a long local test password')).status, 401);
    db.prepare('DELETE FROM auth_attempts').run();
    const good = await login(request, 'maya@example.test', 'a long local test password');
    assert.equal(good.status, 200);
    assert.match(good.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const cookie = good.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/overview', cookie)).status, 200);
    db.prepare('UPDATE staff SET active=0 WHERE id=?').run('maya');
    assert.equal((await request('/overview', cookie)).status, 401);
  });
});

test('one-time worker grant is scoped, expires and revokes redeemed sessions', async () => {
  await withServer(async ({ db, request }) => {
    provisionStaffCredential(db, 'maya', 'maya@example.test', 'a long local test password');
    const staffLogin = await login(request, 'maya@example.test', 'a long local test password');
    const staffCookie = staffLogin.headers.get('set-cookie').split(';')[0];
    const crossSite = await request('/worker-grants', staffCookie, { method: 'POST', body: JSON.stringify({ workerId: 'harbor-worker' }) });
    assert.equal(crossSite.status, 404);
    assignWorkerPassword(db,{principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'},'worker-14',{expectedCode:'Worker 014',workerId:'TEAM-014',password:'Assigned synthetic worker password',confirmed:true});
    const issued = await request('/worker-grants', staffCookie, { method: 'POST', body: JSON.stringify({ workerId: 'worker-14', expiresInMinutes: 30 }) });
    assert.equal(issued.status, 201);
    const grant = await issued.json();
    assert.equal(db.prepare('SELECT token_hash FROM worker_grants WHERE id=?').get(grant.id).token_hash.includes(grant.token), false);
    assert.throws(() => db.prepare(`INSERT INTO sessions
      (token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('forged-grant-session', 'cedar', 'beirut', 'worker', 'worker-29',
      new Date(Date.now() + 10000).toISOString(), null, grant.id, 'credential'), /Scope mismatch/);
    const redeem = () => request('/auth/worker/redeem', null, { method: 'POST', body: JSON.stringify({ token: grant.token, company:'cedar',workerId:'TEAM-014',password:'Assigned synthetic worker password' }) });
    const workerLogin = await redeem();
    assert.equal(workerLogin.status, 200);
    assert.equal((await redeem()).status, 401);
    const workerCookie = workerLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/worker/briefings/assignment-14', workerCookie)).status, 200);
    assert.equal((await request('/worker/briefings/assignment-21', workerCookie)).status, 404);
    assert.equal((await request('/overview', workerCookie)).status, 403);
    const revoke = await request(`/worker-grants/${grant.id}/revoke`, staffCookie, { method: 'POST' });
    assert.equal(revoke.status, 200);
    assert.equal((await request('/worker/briefings', workerCookie)).status, 401);
    const second = await request('/worker-grants', staffCookie, { method: 'POST', body: JSON.stringify({ workerId: 'worker-29', expiresInMinutes: 30 }) });
    const expiringGrant = await second.json();
    db.prepare('UPDATE worker_grants SET expires_at=? WHERE id=?').run(new Date(0).toISOString(), expiringGrant.id);
    assert.equal((await request('/auth/worker/redeem', null, { method: 'POST', body: JSON.stringify({ token: expiringGrant.token }) })).status, 401);
  });
});

test('SQLite access metadata pages beyond 100 without secrets and grant mutations recheck authority, replay and rollback',async () => {
  await withServer(async ({db,request}) => {
    const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};
    for(const input of [null,[],{workerId:'worker-14',org_id:'harbor'},{workerId:'worker-14',expiresInMinutes:null},{workerId:'x'.repeat(101)}]) assert.throws(() => grantIssueInput(input),/Invalid/);
    for(const input of [{page:5001},{pageSize:51},{page:0},{token:true},{org_id:'harbor'}]) assert.throws(() => grantFilters('worker-14',input),/Invalid/);
    const insert=db.prepare('INSERT INTO worker_grants VALUES(?,?,?,?,?,?,?,?,?)');
    for(let n=0;n<125;n++) insert.run(`old-${String(n).padStart(3,'0')}`,'cedar','beirut','worker-14',tokenHash(`old-synthetic-${n}`),'2001-01-01T00:00:00.000Z',null,'2000-02-01T00:00:00.000Z','2000-01-01T00:00:00.000Z');
    const grant=issueWorkerGrant(db,owner,'worker-14',30);
    let result=listWorkerGrants(db,owner,'worker-14',{pageSize:20});
    assert.equal(result.total,126);assert.equal(result.items[0].status,'available');assert.equal(result.items[0].id,grant.id);
    assert.deepEqual(Object.keys(result.items[0]).sort(),['id','workerId','createdAt','expiresAt','redeemedAt','revokedAt','status'].sort());
    assert.ok(!/token|hash|rubric|answer|notes/.test(JSON.stringify(result)));
    result=listWorkerGrants(db,owner,'worker-14',{page:7,pageSize:20});assert.equal(result.items.length,6);assert.equal(result.items.at(-1).id,'old-000');
    assert.deepEqual(listWorkerGrants(db,owner,'worker-14',{page:5000}).items,[]);
    const session=redeemWorkerGrant(db,grant.token);assert.equal(listWorkerGrants(db,owner,'worker-14').items[0].status,'redeemed');
    for(const forged of [{...owner,principal_id:'missing'},{...owner,role:'supervisor'},{...owner,site_id:'harbor-yard'},{...owner,principal_type:'worker'}]) {
      assert.throws(() => listWorkerGrants(db,forged,'worker-14'),/Forbidden/);
      assert.throws(() => issueWorkerGrant(db,forged,'worker-14'),/Forbidden/);
      assert.throws(() => revokeWorkerGrant(db,forged,grant.id),/Forbidden/);
    }
    assert.throws(() => listWorkerGrants(db,owner,'harbor-worker'),/unavailable/);
    db.exec("CREATE TRIGGER grant_audit_fail BEFORE INSERT ON audit WHEN NEW.action='grant.revoked' BEGIN SELECT RAISE(ABORT,'Injected failure'); END;");
    assert.throws(() => revokeWorkerGrant(db,owner,grant.id),/Injected/);
    assert.equal(db.prepare('SELECT revoked_at FROM sessions WHERE token_hash=?').get(tokenHash(session.token)).revoked_at,null);
    db.exec('DROP TRIGGER grant_audit_fail');revokeWorkerGrant(db,owner,grant.id);revokeWorkerGrant(db,owner,grant.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='grant.revoked'").get().n,1);
    assert.equal(listWorkerGrants(db,owner,'worker-14').items[0].status,'revoked');
    const expires=issueWorkerGrant(db,owner,'worker-14',5);
    db.prepare('UPDATE worker_grants SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',expires.id);
    assert.equal(listWorkerGrants(db,owner,'worker-14').items.find((row) => row.id===expires.id).status,'expired');
    provisionStaffCredential(db,'maya','maya@example.test','a long local test password');
    const staffCookie=(await login(request,'maya@example.test','a long local test password')).headers.get('set-cookie').split(';')[0];
    const route='/people/workers/worker-14/access?page=7&pageSize=20';
    assert.equal((await request(route)).status,401);
    const response=await request(route,staffCookie);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal((await response.json()).total,127);
    assert.equal((await request('/people/workers/harbor-worker/access',staffCookie)).status,404);
    assert.equal((await request('/people/workers/worker-14/access?org_id=harbor',staffCookie)).status,400);
    assert.equal((await request('/worker-grants',staffCookie,{method:'POST',body:JSON.stringify({workerId:'worker-14',expiresInMinutes:null})})).status,400);
    assert.equal((await request(`/worker-grants/${expires.id}/revoke`,staffCookie,{method:'POST',body:JSON.stringify({workerId:'worker-14'})})).status,400);
    db.prepare("UPDATE workers SET active=0 WHERE id='worker-14'").run();
    assert.equal(listWorkerGrants(db,owner,'worker-14').workerActive,false);assert.throws(() => issueWorkerGrant(db,owner,'worker-14'),/unavailable/);
    db.prepare("UPDATE staff SET active=0 WHERE id='maya'").run();
    assert.throws(() => listWorkerGrants(db,owner,'worker-14'),/Forbidden/);assert.throws(() => revokeWorkerGrant(db,owner,expires.id),/Forbidden/);
  });
});
