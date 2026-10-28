import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { publish } from '../server/domain.mjs';
import { receiveRecording, getRecording, getRecordingAudio } from '../server/recordings.mjs';
import { handleRecordingRoute } from '../server/recording-http.mjs';
import {clientSessionContext} from '../server/session-context.mjs';
import {checkedWorkerReceipt} from '../src/worker-request.ts';
import {createSession,requireSession} from '../server/auth.mjs';
import {openPrincipalSession} from './helpers/sqlite-app.mjs';


const worker30 = { principal_type: 'worker', principal_id: 'worker-30', org_id: 'cedar', site_id: 'beirut' };
const maya = { principal_type: 'staff', principal_id: 'maya', role: 'owner', org_id: 'cedar', site_id: 'beirut' };

function wav() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(32000, 40); bytes.writeInt16LE(1000, 44);
  return bytes;
}

test('recording receipt is private, idempotent and survives version supersession', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-recordings-'));
  const requestId = 'f513c9ba-8337-47ea-8994-cc0ba28e7961';
  try {
    const first = await receiveRecording(db, worker30, 'assignment-30', requestId, wav(), root);
    assert.equal(first.status, 'received');
    assert.equal(first.aiStatus, 'pending');
    assert.equal((await getRecordingAudio(db, worker30, first.id, root)).length, 32044);
    assert.equal(getRecording(db, maya, first.id).assignment_id, 'assignment-30');
    assert.equal(getRecording(db, { ...worker30, principal_id: 'worker-14' }, first.id), undefined);
    assert.throws(() => getRecording(db, { ...maya, org_id: 'harbor', site_id: 'harbor-yard' }, first.id), /Forbidden/);
    assert.throws(() => getRecording(db, { ...maya, role: 'auditor' }, first.id), /Forbidden/);
    const frozen = db.prepare('SELECT snapshot_json FROM publications WHERE id=?').get('shelf-v3').snapshot_json;
    db.prepare('UPDATE briefings SET state=?,prepared_json=? WHERE id=?').run('ready', frozen, 'shelf');
    publish(db, maya, 'shelf',{requestId:randomUUID(),revision:1,nextVersion:4,workerIds:['worker-30']});
    const retry = await receiveRecording(db, worker30, 'assignment-30', requestId, wav(), root);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.id, first.id);
    const different = wav(); different.writeInt16LE(2000, 44);
    await assert.rejects(receiveRecording(db, worker30, 'assignment-30', requestId, different, root), /conflict/);
    await assert.rejects(receiveRecording(db, worker30, 'assignment-30', 'ec62369a-4b67-4c20-a682-ebf4a04fc0a0', wav(), root), /unavailable/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recordings').get().n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('recording HTTP route accepts exact WAV and serves only scoped private audio', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-recording-http-'));
  const principal=db.prepare('SELECT * FROM workers WHERE id=?').get('worker-30');
  const {token}=openPrincipalSession(db,principal);
  let session = requireSession(db,{headers:{cookie:`understood_session=${token}`}},{accessMode:'credential'});
  const server = createServer(async (req, res) => {
    try {
      if (!await handleRecordingRoute(req, res, db, session, new URL(req.url, 'http://localhost').pathname, root)) {
        res.writeHead(404); res.end();
      }
    } catch (error) { res.writeHead(400); res.end(String(error.message)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/worker/briefings/assignment-30/audio`, {
      method: 'POST', headers: { 'content-type': 'audio/wav', 'x-submission-id': '78d9bc59-d142-4494-baba-bd3a7cbcb96e' }, body: wav(),
    });
    assert.equal(response.status, 201);
    const receipt = await response.json();
    checkedWorkerReceipt(receipt,'audio',{requestId:'78d9bc59-d142-4494-baba-bd3a7cbcb96e',assignmentId:'assignment-30',clientContext:clientSessionContext(session).clientContext});
    assert.equal(receipt.aiStatus, 'pending');
    assert.equal((await fetch(`${base}/api/recordings/${receipt.id}`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/recordings/${receipt.id}/audio`)).arrayBuffer()).byteLength, 32044);
    const ranged=await fetch(`${base}/api/recordings/${receipt.id}/audio`,{headers:{range:'bytes=-4'}});
    assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),'bytes 32040-32043/32044');assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),wav().subarray(32040));
    session = { ...worker30, principal_id: 'worker-14' };
    assert.equal((await fetch(`${base}/api/recordings/${receipt.id}/audio`)).status, 400);
    assert.equal((await fetch(`${base}/api/recordings/${receipt.id}/audio`,{headers:{range:'bytes=0-43'}})).status,400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close(); await rm(root, { recursive: true, force: true });
  }
});
