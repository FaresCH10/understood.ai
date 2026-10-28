import test from 'node:test';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { createCrew, createWorker } from '../server/people.mjs';
import { createAppServer } from '../server/index.mjs';
import { ensureWorkerImportSchema, previewWorkerImport, confirmWorkerImport, getWorkerImport, workerImportErrorsCsv } from '../server/worker-import.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const maya = { principal_type: 'staff', principal_id: 'maya', org_id: 'cedar', site_id: 'beirut', role: 'owner' };
const harbor = { ...maya, principal_id: 'harbor-owner', org_id: 'harbor', site_id: 'harbor-yard' };
const worker = { ...maya, principal_type: 'worker', principal_id: 'worker-30' };
function fixture() { const db = openDatabase(':memory:'); seed(db); ensureWorkerImportSchema(db); return db; }
const upload = (text, requestId = randomUUID()) => ({ bytes: Buffer.from(text), filename: 'crew.csv', requestId });

test('quoted BOM CSV validates, explicitly imports atomically and replays without new workers or access grants', () => {
  const db = fixture();
  try {
    const crew = createCrew(db, maya, { name: 'Morning Crew' });
    const input = upload('\uFEFFworker_id,language,crew\r\n"New 031","ar","Morning Crew"\r\nNew 032,ur,\r\n');
    const preview = previewWorkerImport(db, maya, input);
    assert.equal(preview.validRows, 2); assert.equal(preview.invalidRows, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workers WHERE org_id=?').get('cedar').n, 30);
    assert.equal(previewWorkerImport(db, maya, input).duplicate, true);
    assert.throws(() => previewWorkerImport(db, maya, { ...input, bytes: Buffer.from('other') }), /conflict/);
    assert.deepEqual(confirmWorkerImport(db, maya, preview.id), { id: preview.id, status: 'imported', imported: 2, duplicate: false });
    assert.equal(confirmWorkerImport(db, maya, preview.id).duplicate, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workers WHERE org_id=?').get('cedar').n, 32);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM crew_memberships WHERE crew_id=?').get(crew.id).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE publication_id=?').get('shelf-v3').n, 30);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM worker_grants').get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='workers.imported'").get().n, 1);
    assert.throws(() => db.prepare('UPDATE worker_imports SET rows_json=? WHERE id=?').run('[]', preview.id), /immutable/);
  } finally { db.close(); }
});

test('invalid IDs, unsupported languages, duplicate IDs, missing crews and parser failures cannot import', () => {
  const db = fixture();
  try {
    const preview = previewWorkerImport(db, maya, upload('worker_id,language,crew\nWorker 014,ar,\nNew 031,xyz,\nNew 031,en,Other crew\n=CMD(),en,\n'));
    assert.equal(preview.invalidRows, 4);
    assert.throws(() => confirmWorkerImport(db, maya, preview.id), /Fix CSV errors/);
    assert.match(workerImportErrorsCsv(db, maya, preview.id), /"'=CMD\(\)"/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workers WHERE org_id=?').get('cedar').n, 30);
    for (const text of ['worker_id,language\n"unclosed,en\n', 'worker_id,language\nNew 031,en,extra\n', 'worker_id,"language,crew"\nNew 031,en\n', 'worker_id,language\n']) {
      const malformed = previewWorkerImport(db, maya, upload(text));
      assert.equal(malformed.errors.length, 1);
      assert.throws(() => confirmWorkerImport(db, maya, malformed.id), /Fix CSV errors/);
    }
    const invalidUtf8 = previewWorkerImport(db, maya, { ...upload('x'), bytes: Buffer.from([0xff, 0xfe]) });
    assert.match(invalidUtf8.errors[0], /UTF-8/);
    assert.throws(() => previewWorkerImport(db, maya, { ...upload('x'), bytes: Buffer.alloc(256 * 1024 + 1) }), /256 KiB/);
    const large = previewWorkerImport(db, maya, upload('worker_id,language\n' + Array.from({ length: 1001 }, (_, i) => `New ${i},en`).join('\n')));
    assert.match(large.errors[0], /1,000/);
  } finally { db.close(); }
});

test('confirm revalidates changed directory and rolls back every row after a write failure', () => {
  const db = fixture();
  try {
    const first = previewWorkerImport(db, maya, upload('worker_id,language\nNew 031,en\nNew 032,ar\n'));
    createWorker(db, maya, { code: 'New 032', language: 'ur' });
    assert.equal(getWorkerImport(db, maya, first.id).invalidRows, 1);
    assert.throws(() => confirmWorkerImport(db, maya, first.id), /Fix CSV errors/);
    assert.equal(db.prepare('SELECT 1 FROM workers WHERE code=?').get('New 031'), undefined);
    const second = previewWorkerImport(db, maya, upload('worker_id,language\nNew 033,en\nNew 034,ar\n'));
    db.exec("CREATE TRIGGER reject_import_row BEFORE INSERT ON workers WHEN NEW.code='New 034' BEGIN SELECT RAISE(ABORT,'Injected failure'); END");
    assert.throws(() => confirmWorkerImport(db, maya, second.id), /Injected failure/);
    assert.equal(db.prepare('SELECT 1 FROM workers WHERE code=?').get('New 033'), undefined);
    assert.equal(getWorkerImport(db, maya, second.id).status, 'validated');
    assert.throws(() => getWorkerImport(db, harbor, second.id), /unavailable/);
    assert.throws(() => getWorkerImport(db, worker, second.id), /Forbidden/);
    assert.throws(() => previewWorkerImport(db, { ...maya, role: 'auditor' }, upload('x')), /Forbidden/);
    const expiredId = randomUUID();
    db.prepare(`INSERT INTO worker_imports VALUES (?,'cedar','beirut','maya','old.csv','hash','validated','[]','[]',
      '2000-01-01T00:00:00.000Z','2000-01-02T00:00:00.000Z',0,NULL)`).run(expiredId);
    assert.equal(getWorkerImport(db, maya, expiredId).status, 'expired');
    assert.throws(() => confirmWorkerImport(db, maya, expiredId), /expired/);
    assert.equal(db.prepare('SELECT rows_json FROM worker_imports WHERE id=?').get(expiredId).rows_json, null);
  } finally { db.close(); }
});

test('CSV HTTP validates raw body, denies forged scope and separates preview from confirm', async () => {
  const db = openDatabase(':memory:');
  const server = sqliteApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async (principal) => (await loginPrincipal(base, principal))
    .headers.get('set-cookie').split(';')[0];
  try {
    const staffCookie = await login('maya'), harborCookie = await login('harbor-owner'), workerCookie = await login('worker-30');
    const path = `/people/imports/preview?filename=crew.csv&requestId=${randomUUID()}`;
    const send = (cookie) => fetch(`${base}${path}`, { method: 'POST', headers: { cookie, 'content-type': 'text/csv' }, body: 'worker_id,language\nHTTP 031,en\n' });
    assert.equal((await send(workerCookie)).status, 403);
    const response = await send(staffCookie); assert.equal(response.status, 200);
    const preview = await response.json(); assert.equal(preview.validRows, 1);
    assert.equal((await fetch(`${base}/people/imports/${preview.id}`, { headers: { cookie: harborCookie } })).status, 404);
    assert.equal((await fetch(`${base}/people/imports/${preview.id}/confirm`, { method: 'POST', headers: { cookie: staffCookie, 'content-type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workers WHERE code=?').get('HTTP 031').n, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); db.close(); }
});
