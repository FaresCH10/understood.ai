import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { listAuditEvents, getAuditEvent, exportAuditEvents } from '../server/audit.mjs';
import { createAppServer } from '../server/index.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const session = { principal_type: 'staff', principal_id: 'maya', org_id: 'cedar', site_id: 'beirut', role: 'owner' };
function event(db, id, actorType, actorId, action, object, time, org = 'cedar', site = 'beirut') {
  db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(id,org,site,actorType,actorId,action,object,time);
}

test('activity filters and paging are site scoped, civil dates use site timezone and logs resist changes', () => {
  const db = openDatabase(':memory:'); seed(db);
  try {
    event(db,'event-1','staff','maya','briefing.published','shelf-v3','2026-10-03T21:30:00.000Z');
    event(db,'event-2','worker','worker-14','answer.received','attempt-secret','2026-10-03T22:00:00.000Z');
    event(db,'event-3','system','pipeline','audio.generated','job-1','2026-10-04T22:00:00.000Z');
    event(db,'foreign','staff','harbor-owner','private.action','foreign-secret','2026-10-04T12:00:00.000Z','harbor','harbor-yard');
    db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('tripoli','cedar','Tripoli','Asia/Beirut');
    event(db,'other-site','staff','maya','private.action','same-org-secret','2026-10-04T12:00:00.000Z','cedar','tripoli');
    const result = listAuditEvents(db,session,{ date:'2026-10-04',pageSize:1 });
    assert.equal(result.total,2); assert.equal(result.rows[0].id,'event-2');
    assert.equal(listAuditEvents(db,session,{date:'2026-10-04',pageSize:1,page:2}).rows[0].id,'event-1');
    assert.equal(listAuditEvents(db,session,{actorType:'worker'}).rows[0].actor,'Worker 014');
    assert.equal(listAuditEvents(db,session,{search:'Maya'}).total,1);
    assert.equal(listAuditEvents(db,session,{action:'audio.generated'}).total,1);
    assert.ok(!result.actions.includes('private.action'));
    db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('auditor','cedar','beirut','Read-only Auditor','auditor',1);
    const auditor = { ...session, principal_id:'auditor',role:'auditor' };
    assert.equal(getAuditEvent(db,auditor,'event-1').action,'briefing.published');
    assert.throws(() => getAuditEvent(db,session,'foreign'), /unavailable/);
    assert.throws(() => getAuditEvent(db,session,'other-site'), /unavailable/);
    assert.throws(() => listAuditEvents(db,{...session,site_id:'tripoli'}), /Forbidden/);
    assert.throws(() => listAuditEvents(db,{...session,principal_type:'worker'}), /Forbidden/);
    assert.throws(() => listAuditEvents(db,session,{date:'2026-02-30'}), /Invalid/);
    assert.throws(() => listAuditEvents(db,session,{org_id:'harbor'}), /Invalid/);
    assert.throws(() => listAuditEvents(db,session,{pageSize:51}), /Invalid/);
    assert.throws(() => db.prepare("UPDATE audit SET action='forged' WHERE id='event-1'").run(), /read-only/);
    assert.throws(() => db.prepare("DELETE FROM audit WHERE id='event-1'").run(), /read-only/);
    db.prepare('UPDATE staff SET active=0 WHERE id=?').run('maya');
    assert.throws(() => getAuditEvent(db,session,'event-1'), /Forbidden/);
  } finally { db.close(); }
});

test('activity download uses filtered metadata only, neutralizes formulas and logs the export', () => {
  const db = openDatabase(':memory:'); seed(db);
  try {
    db.prepare("UPDATE staff SET name='=HYPERLINK(\"evil\")' WHERE id='maya'").run();
    event(db,'csv-1','staff','maya','test.created','@bad','2026-10-04T12:00:00.000Z');
    const csv = exportAuditEvents(db,session,{action:'test.created'});
    assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("'@bad"));
    assert.ok(!/blue shelf|password|answer_text|rubric|token_hash/i.test(csv));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='audit.exported'").get().n,1);
    event(db,'oversize','system','pipeline','oversize','x'.repeat(2_000_000),'2026-10-04T12:00:00.000Z');
    assert.throws(() => exportAuditEvents(db,session,{action:'oversize'}), /exceeds export limit/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='audit.exported'").get().n,1);
    db.exec('BEGIN');
    for (let n=0;n<5001;n++) event(db,`bounded-${n}`,'system','pipeline','bounded','job','2026-10-04T12:00:00.000Z');
    db.exec('COMMIT');
    assert.throws(() => exportAuditEvents(db,session,{action:'bounded'}), /exceeds limit/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='audit.exported'").get().n,1);
  } finally { db.close(); }
});

test('activity HTTP denies anonymous, worker, foreign event, forged filters and revoked staff', async () => {
  const db = openDatabase(':memory:');
  const server = sqliteApp(db);
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (principal) => (await loginPrincipal(base, principal)).headers.get('set-cookie').split(';')[0];
  const request = (cookie,path) => fetch(base+path,{headers:cookie ? {cookie} : {}});
  try {
    event(db,'http-event','staff','maya','test.created','item','2026-10-04T12:00:00.000Z');
    const maya = await login('maya'), other = await login('harbor-owner'), worker = await login('worker-29');
    assert.equal((await request(null,'/audit')).status,401);
    for (const path of ['/audit','/audit/http-event','/audit.csv']) assert.equal((await request(worker,path)).status,403);
    assert.equal((await request(other,'/audit/http-event')).status,404);
    assert.equal((await request(maya,'/audit?site_id=harbor-yard')).status,400);
    assert.equal((await request(maya,'/audit/http-event')).status,200);
    const csv = await request(maya,'/audit.csv?action=test.created');
    assert.equal(csv.status,200); assert.equal(csv.headers.get('cache-control'),'no-store');
    assert.ok((await csv.text()).includes('http-event'));
    db.prepare('UPDATE staff SET active=0 WHERE id=?').run('maya');
    assert.equal((await request(maya,'/audit')).status,401);
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});
