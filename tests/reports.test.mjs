import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { createAppServer } from '../server/index.mjs';
import { receiveRecording } from '../server/recordings.mjs';
import {sqliteApp,loginPrincipal} from './helpers/sqlite-app.mjs';


function wav() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(32000, 40); bytes.writeInt16LE(1000, 44);
  return bytes;
}

test('report CSV is site scoped, formula safe, and distinguishes a received audio answer', async () => {
  const db = openDatabase(':memory:');
  const audioRoot = await mkdtemp(join(tmpdir(), 'understood-report-'));
  const server = sqliteApp(db,{audioRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const signIn = async (principal) => {
    const response = await loginPrincipal(base, principal);
    return response.headers.get('set-cookie').split(';')[0];
  };
  try {
    db.prepare('UPDATE workers SET code=? WHERE id=?').run('=HYPERLINK("https://bad.example")', 'worker-29');
    await receiveRecording(db, { principal_type: 'worker', principal_id: 'worker-29', org_id: 'cedar', site_id: 'beirut' },
      'assignment-29', '9a1c19c9-1be8-43bf-a526-274e658530c2', wav(), audioRoot);
    const maya = await signIn('maya'), worker = await signIn('worker-29'), harbor = await signIn('harbor-owner');
    const response = await fetch(`${base}/reports.csv`, { headers: { cookie: maya } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/csv/);
    const csv = await response.text();
    assert.equal(csv.split('\r\n').filter(Boolean).length, 31);
    assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad\.example""\)"/);
    assert.match(csv, /"received","unassessed"/);
    assert.equal(csv.includes('Harbor Owner'), false);
    assert.equal((await fetch(`${base}/reports.csv`, { headers: { cookie: worker } })).status, 403);
    assert.equal((await fetch(`${base}/reports.csv`, { headers: { cookie: harbor } })).status, 404);
    assert.equal((await fetch(`${base}/reports.csv`)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close(); await rm(audioRoot, { recursive: true, force: true });
  }
});
