import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { seed } from '../server/seed.mjs';
import { metrics, submitAnswer } from '../server/domain.mjs';
import { receiveRecording } from '../server/recordings.mjs';
import { processOneRecording } from '../server/recording-worker.mjs';

const worker = { principal_type: 'worker', principal_id: 'worker-30', org_id: 'cedar', site_id: 'beirut' };

function wav() {
  const bytes = Buffer.alloc(32044);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(32000, 40); bytes.writeInt16LE(1000, 44);
  return bytes;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('failed private storage never counts as a response or returns a receipt on duplicate', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const payload = wav();
  const submissionId = '629756e8-78d8-4ab5-89a5-94947c71553c';
  const unavailableStore = { async save() { throw new Error('Storage unavailable'); } };
  try {
    await assert.rejects(receiveRecording(db, worker, 'assignment-30', submissionId, payload, unavailableStore), /Private storage failed/);
    const row = db.prepare('SELECT status,received_at FROM recordings WHERE assignment_id=? AND submission_id=?')
      .get('assignment-30', submissionId);
    assert.equal(row.status, 'failed');
    assert.equal(row.received_at, null);
    assert.deepEqual(metrics(db, 'cedar', 'shelf-v3'), {
      assigned: 30, responses: 24, matches: 21, clarifications: 3, unassessed: 0, pending: 6, completion: 80,
    });
    await assert.rejects(receiveRecording(db, worker, 'assignment-30', submissionId, payload, unavailableStore), /unavailable/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recordings WHERE assignment_id=?').get('assignment-30').n, 1);
  } finally { db.close(); }
});

test('same-millisecond audio receipts are ordered by durable receipt sequence', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-03T17:00:00.000Z') });
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-receipt-order-'));
  try {
    const first = await receiveRecording(db, worker, 'assignment-30', '8dabde2a-e173-4cf0-b973-8110bb4cb532', wav(), root);
    await assert.throws(() => submitAnswer(db, worker, 'assignment-30', 'later-typed-same-millisecond', 'Finished blue; unfinished yellow.'), /approved repeat/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?').get('assignment-30').n, 0);
    db.prepare("UPDATE recordings SET status='failed' WHERE id=?").run(first.id);
    await receiveRecording(db, worker, 'assignment-30', '9dabde2a-e173-4cf0-b973-8110bb4cb532', wav(), root);
    const receipts = db.prepare('SELECT kind,received_at,sequence,submission_id FROM submission_receipts WHERE assignment_id=? ORDER BY sequence').all('assignment-30');
    assert.equal(receipts.length, 2);
    assert.equal(receipts[0].received_at, receipts[1].received_at);
    assert.deepEqual(receipts.map((row) => row.kind), ['audio', 'audio']);
    assert.equal(receipts[1].submission_id, '9dabde2a-e173-4cf0-b973-8110bb4cb532');
    assert.ok(receipts[0].sequence < receipts[1].sequence);
    assert.equal(metrics(db, 'cedar', 'shelf-v3').matches, 21);
    assert.equal(metrics(db, 'cedar', 'shelf-v3').unassessed, 1);
    assert.equal(metrics(db, 'cedar', 'shelf-v3').responses, 25);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('post-save database failure compensates the object and cannot issue a receipt', async () => {
  const db = openDatabase(':memory:'); seed(db);
  let saved = 0, removed = 0;
  const storage = {
    async save() { saved++; db.exec("CREATE TRIGGER reject_audio_receipt BEFORE INSERT ON submission_receipts WHEN NEW.kind='audio' BEGIN SELECT RAISE(ABORT,'Injected DB failure'); END"); },
    async remove() { removed++; },
  };
  try {
    await assert.rejects(receiveRecording(db, worker, 'assignment-30', '6dabde2a-e173-4cf0-b973-8110bb4cb532', wav(), storage), /Private storage failed/);
    assert.equal(saved, 1); assert.equal(removed, 1);
    assert.equal(db.prepare('SELECT status,received_at FROM recordings WHERE assignment_id=?').get('assignment-30').received_at, null);
    assert.equal(metrics(db, 'cedar', 'shelf-v3').responses, 24);
  } finally { db.close(); }
});

test('expired voice assignments reject before storage and preserve already accepted retries', async () => {
  const db = openDatabase(':memory:'); seed(db);
  let saved = 0;
  const storage = { async save() { saved++; }, async remove() {} };
  const id = '4dabde2a-e173-4cf0-b973-8110bb4cb532';
  try {
    const first = await receiveRecording(db, worker, 'assignment-30', id, wav(), storage);
    db.prepare("UPDATE assignments SET due_at='2000-01-01T00:00:00Z' WHERE id='assignment-30'").run();
    assert.equal((await receiveRecording(db, worker, 'assignment-30', id, wav(), storage)).id, first.id);
    await assert.rejects(receiveRecording(db, worker, 'assignment-30', '5dabde2a-e173-4cf0-b973-8110bb4cb532', wav(), storage), /deadline passed/);
    assert.equal(saved, 1);
  } finally { db.close(); }
});

test('authority or deadline changes during private storage compensate the object without accepting an answer', async () => {
  for (const change of [
    "UPDATE assignments SET due_at='2000-01-01T00:00:00Z' WHERE id='assignment-30'",
    "UPDATE publications SET state='withdrawn' WHERE id='shelf-v3'",
    "UPDATE workers SET active=0 WHERE id='worker-30'",
  ]) {
    const db = openDatabase(':memory:'); seed(db);
    let removed = 0;
    const storage = { async save() { db.exec(change); }, async remove() { removed++; } };
    try {
      await assert.rejects(receiveRecording(db, worker, 'assignment-30', '7dabde2a-e173-4cf0-b973-8110bb4cb532', wav(), storage), /Private storage failed/);
      assert.equal(removed, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM submission_receipts WHERE assignment_id=?').get('assignment-30').n, 0);
      assert.equal(db.prepare('SELECT received_at FROM recordings WHERE assignment_id=?').get('assignment-30').received_at, null);
    } finally { db.close(); }
  }
});

test('a reclaimed lease fences the older worker from saving transcript or assessment', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-lease-reliability-'));
  const firstStarted = deferred();
  const releaseFirst = deferred();
  try {
    const receipt = await receiveRecording(db, worker, 'assignment-30',
      'b33c21af-2826-4482-9f77-d90575bb6817', wav(), root);
    const firstAdapter = {
      async transcribe() { firstStarted.resolve(); return releaseFirst.promise; },
      async assess() { throw new Error('Stale worker reached assessment'); },
    };
    const firstRun = processOneRecording(db, firstAdapter, root);
    await firstStarted.promise;
    const firstToken = db.prepare('SELECT lease_token FROM recordings WHERE id=?').get(receipt.id).lease_token;
    db.prepare('UPDATE recordings SET lease_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z', receipt.id);
    const secondAdapter = {
      async transcribe() { return { text: 'Finished items go on blue; unfinished items go on yellow.' }; },
      async assess() { return { outcome: 'matched', reasons: ['asked_facts_present'], evidence: [] }; },
    };
    assert.equal(await processOneRecording(db, secondAdapter, root), true);
    releaseFirst.resolve({ text: 'Older, incorrect transcript' });
    assert.equal(await firstRun, true);
    const row = db.prepare('SELECT status,attempts,transcript,lease_token FROM recordings WHERE id=?').get(receipt.id);
    assert.equal(row.status, 'transcribed');
    assert.equal(row.attempts, 2);
    assert.equal(row.transcript, 'Finished items go on blue; unfinished items go on yellow.');
    assert.equal(row.lease_token, null);
    assert.ok(firstToken);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?').get('assignment-30').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit WHERE action=? AND object_id IN (SELECT id FROM attempts WHERE assignment_id=?)')
      .get('answer.checked', 'assignment-30').n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('a stale assessment cannot commit after another worker reclaims the lease', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-assess-lease-'));
  const assessmentStarted = deferred();
  const releaseOldAssessment = deferred();
  try {
    const receipt = await receiveRecording(db, worker, 'assignment-30',
      '8fbe4e69-95de-442a-a3de-52df4a86610a', wav(), root);
    const firstAdapter = {
      async transcribe() { return { text: 'Finished items on blue; unfinished items on yellow.' }; },
      async assess() { assessmentStarted.resolve(); return releaseOldAssessment.promise; },
    };
    const oldRun = processOneRecording(db, firstAdapter, root);
    await assessmentStarted.promise;
    const oldToken = db.prepare('SELECT lease_token,transcript FROM recordings WHERE id=?').get(receipt.id);
    assert.match(oldToken.transcript, /unfinished/);
    db.prepare('UPDATE recordings SET lease_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z', receipt.id);
    const secondAdapter = {
      async transcribe() { throw new Error('Stored transcript should be reused'); },
      async assess() { return { outcome: 'matched', reasons: ['asked_facts_present'], evidence: [] }; },
    };
    assert.equal(await processOneRecording(db, secondAdapter, root), true);
    releaseOldAssessment.resolve({ outcome: 'clarification', reasons: ['missing_asked_fact'], evidence: [] });
    assert.equal(await oldRun, true);
    const row = db.prepare('SELECT status,attempts,lease_token FROM recordings WHERE id=?').get(receipt.id);
    assert.equal(row.status, 'transcribed');
    assert.equal(row.attempts, 2);
    assert.equal(row.lease_token, null);
    assert.ok(oldToken.lease_token);
    const attempts = db.prepare('SELECT outcome FROM attempts WHERE assignment_id=?').all('assignment-30');
    assert.deepEqual(attempts.map((attempt) => attempt.outcome), ['matched']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clarifications WHERE assignment_id=?').get('assignment-30').n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('typed submission during in-flight audio assessment requires an approved repeat and cannot replace its outcome', async () => {
  const db = openDatabase(':memory:'); seed(db);
  const root = await mkdtemp(join(tmpdir(), 'understood-outcome-reliability-'));
  const assessmentStarted = deferred();
  const releaseAssessment = deferred();
  const audioSubmission = 'f631e7ab-bff2-4514-ad79-c1b7f35a778a';
  try {
    const receipt = await receiveRecording(db, worker, 'assignment-30', audioSubmission, wav(), root);
    db.prepare('UPDATE recordings SET received_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', receipt.id);
    const adapter = {
      async transcribe() { return { text: 'Finished items go on blue and unfinished items on yellow.' }; },
      async assess() { assessmentStarted.resolve(); return releaseAssessment.promise; },
    };
    const audioRun = processOneRecording(db, adapter, root);
    await assessmentStarted.promise;
    await assert.throws(() => submitAnswer(db, worker, 'assignment-30', 'typed-after-audio-30', 'Finished items go on the blue shelf.'), /approved repeat/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM submission_receipts WHERE assignment_id=?').get('assignment-30').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE assignment_id=?').get('assignment-30').n, 0);
    releaseAssessment.resolve({ outcome: 'matched', reasons: ['asked_facts_present'], evidence: [] });
    assert.equal(await audioRun, true);
    const attempts = db.prepare('SELECT submission_id,outcome,received_at FROM attempts WHERE assignment_id=?').all('assignment-30');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].submission_id, audioSubmission);
    assert.equal(attempts[0].outcome, 'matched');
    assert.equal(attempts[0].received_at, '2020-01-01T00:00:00.000Z');
    assert.deepEqual(metrics(db, 'cedar', 'shelf-v3'), {
      assigned: 30, responses: 25, matches: 22, clarifications: 3, unassessed: 0, pending: 5, completion: 83,
    });
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
