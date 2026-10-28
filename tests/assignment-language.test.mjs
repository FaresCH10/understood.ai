import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { createAppServer } from '../server/index.mjs';
import { activityRows } from '../server/reports.mjs';
import { listClarifications } from '../server/clarifications.mjs';
import { publish } from '../server/domain.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


const maya={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner'};

test('SQLite publication language remains frozen across preference changes in worker, reports and clarification reads',async () => {
  const db=openDatabase(':memory:'); seed(db);
  const server=sqliteApp(db);
  await new Promise((done) => server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  try {
    const original=db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json;
    db.prepare("UPDATE workers SET language='ur' WHERE id='worker-14'").run();
    const login=await loginPrincipal(base, 'worker-14');
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const detail=await (await fetch(`${base}/worker/briefings/assignment-14`,{headers:{cookie}})).json();
    assert.equal(detail.language,'ar'); assert.equal(detail.content.question,JSON.parse(original).languages.ar.question);
    assert.equal((await (await fetch(`${base}/worker/briefings`,{headers:{cookie}})).json()).items[0].language,'ar');
    const rows=activityRows(db,maya,db.prepare("SELECT * FROM publications WHERE id='shelf-v3'").get());
    assert.equal(rows.find((row) => row[0]==='Worker 014')[1],'ar');
    assert.equal(listClarifications(db,maya).rows.find((row) => row.id==='clarification-14').language,'ar');
    assert.throws(() => db.prepare("UPDATE assignments SET language='ur' WHERE id='assignment-14'").run(),/immutable/);
    db.prepare("UPDATE briefings SET state='ready',prepared_json=? WHERE id='shelf'").run(original);
    const next=publish(db,maya,'shelf',{requestId:randomUUID(),revision:1,nextVersion:4,workerIds:['worker-14']});
    assert.equal(db.prepare('SELECT language FROM assignments WHERE publication_id=?').get(next.id).language,'ur');
    assert.equal(db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json,original);
  } finally { await new Promise((done) => server.close(done)); db.close(); }
});

test('legacy SQLite upgrade freezes available current preference once without changing publication or answer evidence',async () => {
  const root=await mkdtemp(join(tmpdir(),'understood-language-upgrade-')),path=join(root,'legacy.sqlite');
  let db=openDatabase(path); seed(db);
  try {
    const before=db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json;
    const attempts=db.prepare('SELECT * FROM attempts ORDER BY id').all();
    db.exec('DROP TRIGGER assignment_language_frozen; DROP TRIGGER assignment_language_available; ALTER TABLE assignments DROP COLUMN language;');
    db.prepare("UPDATE workers SET language='ur' WHERE id='worker-14'").run();
    db.close(); db=openDatabase(path);
    assert.equal(db.prepare("SELECT language FROM assignments WHERE id='assignment-14'").get().language,'ur');
    assert.deepEqual(db.prepare('SELECT * FROM attempts ORDER BY id').all(),attempts);
    assert.equal(db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json,before);
    db.prepare("UPDATE workers SET language='en' WHERE id='worker-14'").run();
    db.close(); db=openDatabase(path);
    assert.equal(db.prepare("SELECT language FROM assignments WHERE id='assignment-14'").get().language,'ur');
    assert.throws(() => db.prepare("UPDATE assignments SET language='en' WHERE id='assignment-14'").run(),/immutable/);
  } finally { db.close(); await rm(root,{recursive:true,force:true}); }
});
