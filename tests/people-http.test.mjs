import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createAppServer } from '../server/index.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


test('People HTTP controls enforce site authority and preserve publication audience', async () => {
  const db = openDatabase(':memory:');
  const server = sqliteApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (principal) => {
    const response = await loginPrincipal(base, principal);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const request = (cookie, path, method = 'GET', body) => fetch(base + path, { method,
    headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    const maya = await login('maya'), other = await login('harbor-owner'), worker = await login('worker-29');
    assert.equal((await request(worker, '/people/workers')).status, 403);
    const list = await (await request(maya, '/people/workers?language=ur&page=1&pageSize=5')).json();
    assert.equal(list.total, 8); assert.equal(list.items.length, 5);
    assert.equal((await request(maya,'/people/workers','POST',{code:'MISSING-PASSWORD'})).status,400);
    const added = await request(maya, '/people/workers', 'POST', { code: 'QA Worker 900', language: 'en', password:'Assigned test password 900' });
    assert.equal(added.status, 201);
    const person = await added.json();
    assert.equal((await request(other, `/people/workers/${person.id}`, 'PATCH', { code: 'Forged' })).status, 404);
    assert.equal((await request(maya, `/people/workers/${person.id}/crew`, 'POST', { crewId: 'other-site' })).status, 404);
    const crew = await (await request(maya, '/people/crews', 'POST', { name: 'QA Crew' })).json();
    const moved = await (await request(maya, `/people/workers/${person.id}/crew`, 'POST', { crewId: crew.id })).json();
    assert.equal(moved.crew_id, crew.id);
    const crewPage=await request(maya,'/people/crews?search=QA&pageSize=1&status=active');assert.equal(crewPage.status,200);assert.match(crewPage.headers.get('cache-control'),/no-store/);
    const crewRows=await crewPage.json();assert.equal(crewRows.total,1);assert.equal(crewRows.pageSize,1);assert.equal(crewRows.items[0].member_count,1);
    assert.equal((await (await request(other,'/people/crews?search=QA')).json()).total,0);
    assert.equal((await request(worker,'/people/crews')).status,403);
    assert.equal((await request(maya,'/people/crews?org_id=harbor')).status,400);
    assert.equal((await request(maya,'/people/crews?page=5001')).status,400);
    assert.equal((await request(maya,'/people/crews?status=archived')).status,400);
    assert.equal((await (await request(maya,`/people/workers?crewId=${crew.id}`)).json()).total,1);
    assert.equal((await (await request(maya,'/people/workers?crewId=none')).json()).total,30);
    assert.equal((await request(other,`/people/workers?crewId=${crew.id}`)).status,404);
    assert.equal((await request(maya,'/people/workers?crewId=')).status,400);
    const disabled = await request(maya, `/people/workers/${person.id}/disable`, 'POST');
    assert.equal(disabled.status, 200); assert.equal((await disabled.json()).active, false);
    assert.equal((await (await request(maya,`/people/workers?crewId=${crew.id}&status=inactive`)).json()).total,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE publication_id=?').get('shelf-v3').n, 30);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit WHERE object_id=?').get(person.id).n, 3);
    const enable={requestId:randomUUID(),expectedCode:person.code,confirmed:true};
    const restore={requestId:randomUUID(),expectedName:crew.name,confirmed:true};
    assert.equal((await request(maya,`/people/crews/${crew.id}/archive`,'POST',{expectedName:crew.name,confirmed:true})).status,200);
    for(const [path,body] of [[`/people/workers/${person.id}/reenable`,enable],[`/people/crews/${crew.id}/restore`,restore]]) {
      assert.equal((await request(worker,path,'POST',body)).status,403);assert.equal((await request(other,path,'POST',body)).status,404);
      assert.equal((await request(maya,path,'POST',{...body,confirmed:false})).status,400);
      assert.equal((await request(maya,path,'POST',{...body,requestId:'bad'})).status,400);
      assert.equal((await request(maya,path,'POST',{...body,org_id:'harbor'})).status,400);
      const accepted=await request(maya,path,'POST',body);assert.equal(accepted.status,200);assert.match(accepted.headers.get('cache-control'),/no-store/);assert.equal((await accepted.json()).active,true);
      assert.equal((await (await request(maya,path,'POST',body)).json()).duplicate,true);
    }
    assert.equal((await request(maya,`/people/workers/${person.id}/reenable`,'POST',{...enable,expectedCode:'Changed'})).status,409);
    assert.equal((await request(maya,`/people/crews/${crew.id}/restore`,'POST',{...restore,expectedName:'Changed'})).status,409);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM directory_reactivations').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE publication_id=?').get('shelf-v3').n,30);
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});
