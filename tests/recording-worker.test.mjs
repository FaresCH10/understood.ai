import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { receiveRecording } from '../server/recordings.mjs';
import { processOneRecording } from '../server/recording-worker.mjs';

function wav() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(32000, 40); bytes.writeInt16LE(1000, 44);
  return bytes;
}

const worker = { principal_type: 'worker', principal_id: 'worker-29', org_id: 'cedar', site_id: 'beirut' };

test('voice answer checks the frozen rubric once and opens one clarification', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-voice-check-'));
  try {
    const receipt = await receiveRecording(db, worker, 'assignment-29', '15741dde-b442-4d06-9e45-48968582e8ba', wav(), root);
    db.prepare("UPDATE workers SET language='en' WHERE id='worker-29'").run();
    let transcriptions = 0, assessments = 0;
    const adapter = {
      async transcribe() { transcriptions++; return { text: 'Finished on blue. I do not know the second shelf.' }; },
      async assess(answer, question, facts) {
        assessments++;
        assert.match(question, /مکمل/);
        assert.deepEqual(facts, ['finished -> blue shelf', 'unfinished -> yellow shelf']);
        assert.match(answer, /second shelf/);
        return { outcome: 'clarification', reasons: ['missing_asked_fact'], evidence: [] };
      },
    };
    assert.equal(await processOneRecording(db, adapter, root), true);
    assert.equal(await processOneRecording(db, adapter, root), false);
    assert.equal(transcriptions, 1); assert.equal(assessments, 1);
    assert.equal(db.prepare('SELECT status FROM recordings WHERE id=?').get(receipt.id).status, 'transcribed');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?').get('assignment-29').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clarifications WHERE assignment_id=?').get('assignment-29').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit WHERE action=?').get('answer.checked').n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('provider failure is retried with a lease and cannot produce a false match', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-voice-retry-'));
  try {
    const receipt = await receiveRecording(db, worker, 'assignment-29', '25741dde-b442-4d06-9e45-48968582e8ba', wav(), root);
    const adapter = { async transcribe() { throw new Error('Provider unavailable'); },async assess(){throw Error('Assessment must not run after transcription fails');} };
    for (let n = 1; n <= 3; n++) {
      assert.equal(await processOneRecording(db, adapter, root), true);
      const row = db.prepare('SELECT status,attempts FROM recordings WHERE id=?').get(receipt.id);
      assert.equal(row.attempts, n);
      assert.equal(row.status, n === 3 ? 'failed' : 'received');
      db.prepare('UPDATE recordings SET retry_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', receipt.id);
    }
    assert.equal(await processOneRecording(db, adapter, root), false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?').get('assignment-29').n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
