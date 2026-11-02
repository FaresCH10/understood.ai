import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.mjs';
import { ensurePeopleSchema, listWorkers, createWorker, readWorkerIdSettings, updateWorkerIdPrefix } from '../server/people.mjs';
import { suggestWorkerPrefix, normalizeWorkerPrefix, workerIdFormat, nextWorkerId } from '../server/worker-ids.mjs';

const owner = { principal_type: 'staff', principal_id: 'stark-owner', org_id: 'stark', site_id: 'stark-site', role: 'owner' };
const supervisor = { ...owner, principal_id: 'stark-supervisor', role: 'supervisor' };
const helton = { principal_type: 'staff', principal_id: 'helton-owner', org_id: 'helton', site_id: 'helton-park', role: 'owner' };

function fixture() {
  const db = openDatabase(':memory:');
  ensurePeopleSchema(db);
  db.prepare('INSERT INTO organizations VALUES (?,?)').run('stark', 'Stark Industry');
  db.prepare('INSERT INTO organizations VALUES (?,?)').run('helton', 'Helton Park');
  db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('stark-site', 'stark', 'Stark site', 'UTC');
  db.prepare('INSERT INTO sites VALUES (?,?,?,?)').run('helton-park', 'helton', 'Helton site', 'UTC');
  db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('stark-owner', 'stark', 'stark-site', 'Owner', 'owner', 1);
  db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('stark-supervisor', 'stark', 'stark-site', 'Supervisor', 'supervisor', 1);
  db.prepare('INSERT INTO staff VALUES (?,?,?,?,?,?)').run('helton-owner', 'helton', 'helton-park', 'Owner', 'owner', 1);
  db.prepare("INSERT INTO workers(id,org_id,site_id,code,language,active) VALUES('demo-worker','stark','stark-site','Worker 001','en',1)").run();
  return db;
}

test('worker ID helpers derive a stable company prefix and next sequence', () => {
  assert.equal(suggestWorkerPrefix('Stark Industry'), 'ST');
  assert.equal(suggestWorkerPrefix('Helton Park'), 'HE');
  assert.equal(suggestWorkerPrefix('Cedar Works'), 'CE');
  assert.equal(suggestWorkerPrefix('   '), 'WK');
  assert.equal(suggestWorkerPrefix(null), 'WK');
  assert.equal(normalizeWorkerPrefix(' ht '), 'HT');
  assert.equal(workerIdFormat('ht'), 'HT-001');
  assert.equal(nextWorkerId('HT', []), 'HT-001');
  assert.equal(nextWorkerId('HT', ['HT-001', 'HT-009', 'Worker 010', 'ht-010']), 'HT-011');
  for (const bad of ['H', 'TOOLONG', 'H-T', 'HT 1', '']) {
    assert.throws(() => normalizeWorkerPrefix(bad), /Invalid worker ID prefix/);
  }
});

test('SQLite numbers worker IDs per company and keeps existing IDs unchanged', () => {
  const db = fixture();
  try {
    assert.deepEqual(readWorkerIdSettings(db, owner), {
      prefix: 'ST', suggestedPrefix: 'ST', format: 'ST-001', nextCode: 'ST-001', canEdit: true,
    });
    assert.equal(createWorker(db, owner, { password: 'Stark-Demo-Pass-1' }).code, 'ST-001');
    assert.equal(createWorker(db, owner, { code: '', password: 'Stark-Demo-Pass-2' }).code, 'ST-002');
    assert.equal(createWorker(db, owner, { code: 'ST-009', password: 'Stark-Demo-Pass-3' }).code, 'ST-009');
    assert.throws(() => createWorker(db, owner, { code: 'st-001', password: 'Stark-Demo-Pass-4' }), /Worker ID already in use/);
    assert.equal(readWorkerIdSettings(db, owner).nextCode, 'ST-010');
    assert.equal(readWorkerIdSettings(db, helton).nextCode, 'HE-001');
    assert.equal(createWorker(db, helton, { password: 'Helton-Demo-Pass-1' }).code, 'HE-001');
    assert.equal(readWorkerIdSettings(db, owner).nextCode, 'ST-010');
    const codes = listWorkers(db, owner, { pageSize: 100 }).items.map((worker) => worker.code);
    assert.ok(codes.includes('Worker 001'));
    assert.ok(codes.includes('ST-001'));
    assert.ok(codes.includes('ST-009'));
  } finally { db.close(); }
});

test('SQLite lets owners change the prefix while supervisors only read it', () => {
  const db = fixture();
  try {
    assert.equal(readWorkerIdSettings(db, supervisor).canEdit, false);
    assert.throws(() => updateWorkerIdPrefix(db, supervisor, { prefix: 'HT' }), /Forbidden/);
    assert.throws(() => updateWorkerIdPrefix(db, owner, { prefix: 'h' }), /Invalid worker ID prefix/);
    assert.throws(() => updateWorkerIdPrefix(db, owner, { prefix: 'TOOLONG' }), /Invalid worker ID prefix/);
    assert.throws(() => updateWorkerIdPrefix(db, owner, { prefix: 'H-T' }), /Invalid worker ID prefix/);
    assert.equal(updateWorkerIdPrefix(db, owner, { prefix: ' st ' }).prefix, 'ST');
    const moved = updateWorkerIdPrefix(db, owner, { prefix: 'ht' });
    assert.equal(moved.format, 'HT-001');
    assert.equal(moved.nextCode, 'HT-001');
    assert.equal(moved.suggestedPrefix, 'ST');
    assert.equal(createWorker(db, owner, { password: 'Stark-Demo-Pass-1' }).code, 'HT-001');
    assert.equal(readWorkerIdSettings(db, owner).nextCode, 'HT-002');
    assert.equal(readWorkerIdSettings(db, owner).suggestedPrefix, 'ST');
    assert.ok(db.prepare("SELECT id FROM audit WHERE action='organization.worker_prefix_updated'").get());
  } finally { db.close(); }
});
