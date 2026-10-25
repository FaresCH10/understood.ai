import {requireWorkerSiteAccess} from './site-access.mjs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { NOW, transaction } from './db.mjs';
import { inspectWav } from './audio.mjs';
import { audioStore } from './private-storage.mjs';
import {ensureAcknowledgementSchema} from './acknowledgments.mjs';
import {ensurePresentationSchema} from './presentation-schema.mjs';
import {checkedPresentationBinding} from './presentations.mjs';
import {workerCredentialSessionValid} from './auth.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';

export const DEFAULT_AUDIO_ROOT = join(process.cwd(), 'data', 'private-audio');

export function ensureRecordingSchema(db) {
  ensureAcknowledgementSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      submission_id TEXT NOT NULL, sha256 TEXT NOT NULL,
      duration_seconds REAL NOT NULL, bytes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('storing','received','processing','blocked','transcribed','failed')),
      transcript TEXT, error TEXT, created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, lease_until TEXT, retry_at TEXT, received_at TEXT, lease_token TEXT,
      presentation_id TEXT REFERENCES presentation_artifacts(id), presentation_language TEXT, presented_question TEXT,
      UNIQUE(assignment_id, submission_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status, created_at);
    CREATE TABLE IF NOT EXISTS submission_receipts (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL REFERENCES organizations(id), assignment_id TEXT NOT NULL REFERENCES assignments(id),
      submission_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('typed','audio')), received_at TEXT NOT NULL,
      UNIQUE(assignment_id,submission_id)
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS submission_receipts_scope_insert BEFORE INSERT ON submission_receipts
      WHEN NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id)
      BEGIN SELECT RAISE(ABORT, 'Scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS submission_receipts_frozen BEFORE UPDATE ON submission_receipts
      BEGIN SELECT RAISE(ABORT, 'Receipt is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS recordings_scope_insert BEFORE INSERT ON recordings
      WHEN NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id)
      BEGIN SELECT RAISE(ABORT, 'Scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS recordings_scope_update BEFORE UPDATE ON recordings
      WHEN NOT EXISTS (SELECT 1 FROM assignments a WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id)
      BEGIN SELECT RAISE(ABORT, 'Scope mismatch'); END;
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(recordings)').all().map((column) => column.name));
  if (!columns.has('attempts')) db.exec('ALTER TABLE recordings ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('lease_until')) db.exec('ALTER TABLE recordings ADD COLUMN lease_until TEXT');
  if (!columns.has('retry_at')) db.exec('ALTER TABLE recordings ADD COLUMN retry_at TEXT');
  if (!columns.has('lease_token')) db.exec('ALTER TABLE recordings ADD COLUMN lease_token TEXT');
  if (!columns.has('received_at')) {
    db.exec('ALTER TABLE recordings ADD COLUMN received_at TEXT');
    db.exec("UPDATE recordings SET received_at=created_at WHERE status IN ('received','processing','blocked','transcribed')");
  }
  // Existing timestamps establish legacy order; all new receipts use a monotonic DB sequence.
  db.exec(`INSERT OR IGNORE INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at)
    SELECT org_id,assignment_id,submission_id,kind,received_at FROM (
      SELECT t.org_id,t.assignment_id,t.submission_id,'typed' AS kind,t.received_at FROM attempts t
        WHERE NOT EXISTS (SELECT 1 FROM recordings r WHERE r.assignment_id=t.assignment_id AND r.submission_id=t.submission_id)
        AND NOT EXISTS (SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=t.assignment_id AND sr.submission_id=t.submission_id)
      UNION ALL SELECT r.org_id,r.assignment_id,r.submission_id,'audio',r.received_at FROM recordings r WHERE r.received_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM submission_receipts sr WHERE sr.assignment_id=r.assignment_id AND sr.submission_id=r.submission_id)
    ) ORDER BY received_at,submission_id`);
  ensurePresentationSchema(db);
}

export function isCurrentRecording(row) {
  return !!row.audio_status && row.audio_submission !== row.attempt_submission
    && (!row.attempt_order || BigInt(row.audio_order) > BigInt(row.attempt_order));
}

function latestAttempt(column) {
  return `(SELECT ${column} FROM attempts t JOIN submission_receipts sr
    ON sr.assignment_id=t.assignment_id AND sr.submission_id=t.submission_id
    WHERE t.assignment_id=a.id ORDER BY sr.sequence DESC LIMIT 1)`;
}
function latestAudio(column) {
  return `(SELECT ${column} FROM recordings r JOIN submission_receipts sr
    ON sr.assignment_id=r.assignment_id AND sr.submission_id=r.submission_id
    WHERE r.assignment_id=a.id AND r.received_at IS NOT NULL ORDER BY sr.sequence DESC LIMIT 1)`;
}
const attemptAndAudioColumns = [
  `${latestAttempt('t.outcome')} AS outcome`, `${latestAttempt('t.received_at')} AS attempt_at`,
  `${latestAttempt('t.submission_id')} AS attempt_submission`, `${latestAttempt('sr.sequence')} AS attempt_order`,
  `${latestAudio('r.id')} AS recording_id`, `${latestAudio('r.status')} AS audio_status`,
  `${latestAudio('r.received_at')} AS audio_at`, `${latestAudio('r.submission_id')} AS audio_submission`,
  `${latestAudio('sr.sequence')} AS audio_order`,
];
export const responseColumns = [...attemptAndAudioColumns,
  `(SELECT ak.received_at FROM acknowledgments ak WHERE ak.assignment_id=a.id AND ak.org_id=a.org_id) AS acknowledged_at`,
].join(',');
export const postgresResponseColumns = [...attemptAndAudioColumns,
  `(SELECT ak.received_at FROM acknowledgments ak WHERE ak.assignment_id=a.id AND ak.org_id=a.org_id) AS acknowledged_at`,
].join(',');

export async function receiveRecording(db, session, assignmentId, submissionId, bytes, root = DEFAULT_AUDIO_ROOT, presentationId = null) {
  if (session.principal_type !== 'worker') throw new Error('Forbidden');
  requireWorkerSiteAccess(db,session.org_id,session.site_id);
  if (typeof submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new Error('Invalid submission ID');
  }
  ensureRecordingSchema(db);
  const assignment = db.prepare(`SELECT a.id,a.due_at,p.state,p.snapshot_json FROM assignments a
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
    WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`).get(assignmentId, session.org_id, session.site_id, session.principal_id);
  if (!assignment) throw new Error('Assignment unavailable');
  const old = db.prepare('SELECT id,status,received_at,sha256,bytes,presentation_id FROM recordings WHERE assignment_id=? AND submission_id=?').get(assignmentId, submissionId);
  if (old) {
    if (presentationId !== null && (typeof presentationId !== 'string' || presentationId !== old.presentation_id))
      throw new Error('Submission ID conflict');
    const info = inspectWav(bytes);
    if (info.sha256 !== old.sha256 || info.bytes !== old.bytes) throw new Error('Submission ID conflict');
    if (old.status === 'storing') throw new Error('Recording storage still in progress');
    if (old.status === 'failed') throw new Error('Recording unavailable; use a new recording');
    return { id: old.id, status: old.status, receivedAt: old.received_at, duplicate: true };
  }
  requireWritableEntitlement(db,session.org_id);
  if (assignment.state !== 'published') throw new Error('Assignment unavailable');
  if (assignment.due_at && assignment.due_at<=NOW()) throw new Error('Assignment deadline passed');
  if (JSON.parse(assignment.snapshot_json)?.responseMode==='acknowledge') throw new Error('This instruction only requires confirmation');
  if (db.prepare('SELECT 1 FROM attempts WHERE assignment_id=? AND submission_id=?').get(assignmentId, submissionId))
    throw new Error('Submission ID conflict');
  const presentation=checkedPresentationBinding(db,session,assignmentId,presentationId);
  const info = inspectWav(bytes);
  const id = randomUUID(), now = NOW();
  transaction(db, () => {
    db.prepare(`INSERT INTO recordings (id,org_id,site_id,assignment_id,submission_id,sha256,duration_seconds,bytes,status,transcript,error,created_at,
      presentation_id,presentation_language,presented_question)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, session.org_id, session.site_id,
      assignmentId, submissionId, info.sha256, info.durationSeconds, info.bytes, 'storing', null, null, now,
      presentation?.id ?? null, presentation?.target_language ?? null, presentation?.question ?? null);
  });
  const storage = audioStore(root), reference = { id, org_id: session.org_id, site_id: session.site_id, ...info };
  try {
    await storage.save(reference, bytes);
    transaction(db, () => {
      requireWorkerSiteAccess(db,session.org_id,session.site_id);
      requireWritableEntitlement(db,session.org_id);
      const current=db.prepare(`SELECT a.due_at,p.state FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
        JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id AND w.active=1
        WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`).get(assignmentId,session.org_id,session.site_id,session.principal_id);
      if (!current || current.state!=='published' || (current.due_at && current.due_at<=NOW())) throw new Error('Assignment unavailable');
      if (session.access_mode==='credential' && !workerCredentialSessionValid(db, session)) throw new Error('Sign in required');
      const receivedAt = NOW();
      db.prepare('INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES (?,?,?,?,?)')
        .run(session.org_id, assignmentId, submissionId, 'audio', receivedAt);
      db.prepare('UPDATE recordings SET status=?,received_at=? WHERE id=? AND status=?').run('received', receivedAt, id, 'storing');
    });
  } catch (error) {
    const readOnly=error?.message==='Workspace is read-only';
    db.prepare('UPDATE recordings SET status=?,error=? WHERE id=?').run('failed', readOnly?'Workspace is read-only':'Private storage failed', id);
    try { await storage.remove?.(reference); } catch { /* Retain failed row for object reconciliation. */ }
    throw readOnly ? error : new Error('Private storage failed');
  }
  return { id, status: 'received', aiStatus: 'pending', receivedAt: db.prepare('SELECT received_at FROM recordings WHERE id=?').get(id).received_at, duplicate: false };
}

export function getRecording(db, session, id) {
  ensureRecordingSchema(db);
  if(!session || !['staff','worker'].includes(session.principal_type))throw new Error('Forbidden');
  if(session.principal_type==='worker')requireWorkerSiteAccess(db,session.org_id,session.site_id);
  const table=session.principal_type==='worker'?'workers':'staff';
  if(!db.prepare(`SELECT id FROM ${table} WHERE id=? AND org_id=? AND site_id=? AND active=1 ${table==='staff'?'AND role=?':''}`)
    .get(session.principal_id,session.org_id,session.site_id,...(table==='staff'?[session.role]:[])))throw new Error('Forbidden');
  if(session.token_hash && !db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND org_id=? AND site_id=? AND principal_type=?
    AND principal_id=? AND revoked_at IS NULL AND expires_at>?`).get(session.token_hash,session.org_id,session.site_id,session.principal_type,session.principal_id,NOW()))throw new Error('Sign in required');
  if(session.principal_type==='worker' && session.access_mode==='credential' && !workerCredentialSessionValid(db, session))throw new Error('Sign in required');
  if (session.principal_type === 'worker') {
    return db.prepare(`SELECT r.* FROM recordings r JOIN assignments a ON a.id=r.assignment_id
      WHERE r.id=? AND r.org_id=? AND r.site_id=? AND a.worker_id=?`).get(id, session.org_id, session.site_id, session.principal_id);
  }
  if (session.principal_type === 'staff') {
    if (!['owner', 'supervisor'].includes(session.role)) throw new Error('Forbidden');
    return db.prepare('SELECT * FROM recordings WHERE id=? AND org_id=? AND site_id=?').get(id, session.org_id, session.site_id);
  }
  throw new Error('Forbidden');
}

export async function getRecordingAudio(db, session, id, root = DEFAULT_AUDIO_ROOT) {
  const row = getRecording(db, session, id);
  if (!row || !['received', 'processing', 'blocked', 'transcribed'].includes(row.status)) throw new Error('Recording unavailable');
  const bytes=await audioStore(root).read(row);
  const current=getRecording(db,session,id);
  if(!current || !['received','processing','blocked','transcribed'].includes(current.status))throw new Error('Recording unavailable');
  return bytes;
}
