import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { createAppServer } from '../server/index.mjs';
import { submitAnswer } from '../server/domain.mjs';
import { activityRows, languageBreakdown } from '../server/reports.mjs';
import { requestExport, processOneExport, listExports, downloadExport, retryExport } from '../server/exports.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const maya = { principal_type: 'staff', principal_id: 'maya', org_id: 'cedar', site_id: 'beirut', role: 'owner' };
const harbor = { ...maya, principal_id: 'harbor-owner', org_id: 'harbor', site_id: 'harbor-yard' };
const worker = { principal_type: 'worker', principal_id: 'worker-30', org_id: 'cedar', site_id: 'beirut' };
const fixture = () => { const db = openDatabase(':memory:'); seed(db); return db; };

test('queued export freezes current evidence, replays once and keeps private content out', () => {
  const db = fixture();
  try {
    db.prepare('UPDATE workers SET code=? WHERE id=?').run(' =CMD()', 'worker-30');
    const body = { requestId: randomUUID(), publicationId: 'shelf-v3' };
    const result = requestExport(db, maya, body);
    assert.equal(result.status, 'queued');
    assert.equal(requestExport(db, maya, body).duplicate, true);
    assert.throws(() => requestExport(db, maya, { ...body, publicationId: 'other' }), /conflict/);
    assert.throws(() => downloadExport(db, maya, result.id), /not ready/);
    submitAnswer(db, worker, 'assignment-30', randomUUID(), 'finished on the blue shelf and unfinished on the yellow shelf');
    assert.equal(processOneExport(db), true);
    assert.equal(processOneExport(db), false);
    const file = downloadExport(db, maya, result.id);
    assert.equal(file.csv.split('\r\n').filter(Boolean).length, 31);
    assert.match(file.csv, /"' =CMD\(\)","ur","awaiting_response"/);
    assert.equal(file.csv.includes('rubric'), false);
    assert.equal(file.csv.includes('finished on the blue shelf'), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='export.ready'").get().n, 1);
    assert.throws(() => db.prepare('UPDATE report_exports SET publication_id=? WHERE id=?').run('other', result.id), /immutable/);
    assert.throws(() => db.prepare('UPDATE report_exports SET snapshot_json=? WHERE id=?').run('[]', result.id), /immutable/);
    assert.equal(JSON.stringify(listExports(db, maya)).includes('snapshot'), false);
  } finally { db.close(); }
});

test('exports recover expired leases, fence revoked requester and enforce bounded retries and expiry', () => {
  const db = fixture();
  try {
    const first = requestExport(db, maya, { requestId: randomUUID(), publicationId: 'shelf-v3' });
    db.prepare("UPDATE report_exports SET status='processing',attempts=1,lease_token='dead-worker',lease_until=? WHERE id=?")
      .run(new Date(0).toISOString(), first.id);
    assert.equal(processOneExport(db), true);
    assert.equal(listExports(db, maya)[0].attempts, 2);
    const second = requestExport(db, maya, { requestId: randomUUID(), publicationId: 'shelf-v3' });
    db.prepare('UPDATE staff SET active=0 WHERE id=?').run('maya');
    assert.equal(processOneExport(db), true);
    assert.equal(db.prepare('SELECT status FROM report_exports WHERE id=?').get(second.id).status, 'failed');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='export.failed' AND object_id=?").get(second.id).n, 1);
    assert.throws(() => downloadExport(db, maya, first.id), /Forbidden/);
    db.prepare('UPDATE staff SET active=1 WHERE id=?').run('maya');
    retryExport(db, maya, second.id,{requestId:randomUUID(),attempts:1});
    assert.equal(processOneExport(db), true);
    db.prepare("UPDATE report_exports SET status='failed',attempts=3 WHERE id=?").run(second.id);
    assert.throws(() => retryExport(db, maya, second.id,{requestId:randomUUID(),attempts:2}), /cannot be retried/);
    const expiredId = randomUUID();
    db.prepare(`INSERT INTO report_exports(id,org_id,site_id,publication_id,requested_by,created_at,expires_at,status,snapshot_json,csv)
      VALUES (?,'cedar','beirut','shelf-v3','maya','2000-01-01T00:00:00.000Z','2000-01-02T00:00:00.000Z','ready','[]','private')`).run(expiredId);
    assert.equal(requestExport(db, maya, { requestId: expiredId, publicationId: 'shelf-v3' }).status, 'expired');
    assert.throws(() => downloadExport(db, maya, expiredId), /expired/);
    assert.deepEqual({ ...db.prepare('SELECT snapshot_json,csv,status FROM report_exports WHERE id=?').get(expiredId) },
      { snapshot_json: null, csv: null, status: 'expired' });
    assert.throws(() => downloadExport(db, harbor, first.id), /unavailable/);
    assert.throws(() => requestExport(db, worker, { requestId: randomUUID(), publicationId: 'shelf-v3' }), /Forbidden/);
  } finally { db.close(); }
});

test('language completion uses assigned denominators from persisted latest evidence', () => {
  const db = fixture();
  try {
    const publication = db.prepare('SELECT * FROM publications WHERE id=?').get('shelf-v3');
    const languages = languageBreakdown(activityRows(db, maya, publication));
    assert.equal(languages.reduce((sum, row) => sum + row.assigned, 0), 30);
    assert.equal(languages.reduce((sum, row) => sum + row.received, 0), 24);
    for (const row of languages) assert.equal(row.completion, Math.round(row.received / row.assigned * 100));
  } finally { db.close(); }
});

test('export HTTP routes deny worker and forged tenant identifiers, then download only ready output', async () => {
  const db = openDatabase(':memory:');
  const server = sqliteApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (principal) => (await loginPrincipal(base, principal)).headers.get('set-cookie').split(';')[0];
  const req = (path, cookie, body) => fetch(`${base}${path}`, { method: body ? 'POST' : 'GET',
    headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    const staffCookie = await login('maya'), harborCookie = await login('harbor-owner'), workerCookie = await login('worker-30');
    const body = { requestId: randomUUID(), publicationId: 'shelf-v3' };
    assert.equal((await req('/reports/exports', workerCookie, body)).status, 403);
    assert.equal((await req('/reports/exports', harborCookie, body)).status, 404);
    assert.equal((await req('/reports?publicationId=shelf-v3', harborCookie)).status, 404);
    const response = await req('/reports/exports', staffCookie, body);
    assert.equal(response.status, 202);
    const queued = await response.json();
    assert.equal((await req(`/reports/exports/${queued.id}/download`, staffCookie)).status, 409);
    processOneExport(db);
    assert.equal((await req(`/reports/exports/${queued.id}/download`, harborCookie)).status, 404);
    assert.equal((await req(`/reports/exports/${queued.id}/download`, workerCookie)).status, 403);
    const download = await req(`/reports/exports/${queued.id}/download`, staffCookie);
    assert.equal(download.status, 200); assert.match(download.headers.get('content-type'), /text\/csv/);
    assert.equal((await download.text()).split('\r\n').filter(Boolean).length, 31);
    const report = await (await req('/reports', staffCookie)).json();
    assert.equal(report.publicationId, 'shelf-v3'); assert.equal(report.timezone, 'Asia/Beirut');
    assert.equal(report.languages.length, 3);
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});
