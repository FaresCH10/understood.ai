import { randomUUID } from 'node:crypto';
import { NOW, transaction } from './db.mjs';
import { audioStore } from './private-storage.mjs';
import { DEFAULT_AUDIO_ROOT, ensureRecordingSchema } from './recordings.mjs';
import {routeNewCase} from './case-routing.mjs';
import {recordPresentationBinding} from './presentations.mjs';
import {staffAuditOnce} from './notification-events.mjs';

const MAX_ATTEMPTS = 3;

export async function processOneRecording(db, adapter, root = DEFAULT_AUDIO_ROOT) {
  ensureRecordingSchema(db);
  if(typeof adapter?.transcribe!=='function' || typeof adapter?.assess!=='function'){
    const row=db.prepare("SELECT id FROM recordings WHERE status='received' ORDER BY created_at,id LIMIT 1").get();
    if(!row)return false;
    db.prepare("UPDATE recordings SET status='blocked',lease_until=NULL,lease_token=NULL,error='Recorded answer checking is unavailable in this local runtime. Use text or the configured PostgreSQL worker.' WHERE id=? AND status='received'").run(row.id);
    return true;
  }
  const claimed = transaction(db, () => {
    const now = NOW();
    const row = db.prepare(`SELECT * FROM recordings WHERE
      (status='received' AND (retry_at IS NULL OR retry_at<=?) AND attempts<?)
      OR (status='processing' AND lease_until<=?)
      ORDER BY created_at,id LIMIT 1`).get(now, MAX_ATTEMPTS, now);
    if (!row) return null;
    if (row.attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE recordings SET status='failed',lease_until=NULL,error='Processing interrupted too many times' WHERE id=?").run(row.id);
      return { ...row, exhausted: true };
    }
    const leaseToken = randomUUID();
    db.prepare("UPDATE recordings SET status='processing',attempts=attempts+1,lease_until=?,lease_token=?,retry_at=NULL,error=NULL WHERE id=?")
      .run(new Date(Date.now() + 180_000).toISOString(), leaseToken, row.id);
    return { ...row, attempts: row.attempts + 1, leaseToken };
  });
  if (!claimed) return false;
  if (claimed.exhausted) return true;

  try {
    const assignment = db.prepare(`SELECT a.id,p.snapshot_json,a.language FROM assignments a
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
      JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
      WHERE a.id=? AND a.org_id=? AND a.site_id=? AND w.active=1`).get(claimed.assignment_id, claimed.org_id, claimed.site_id);
    if (!assignment) throw new Error('Assignment unavailable');
    const snapshot = JSON.parse(assignment.snapshot_json);
    const askedFacts = snapshot.rubric?.askedFacts;
    if (!Array.isArray(askedFacts) || !askedFacts.length || !askedFacts.every((fact) => typeof fact === 'string')) {
      throw new Error('Published rubric unavailable');
    }
    let transcript = claimed.transcript;
    if (!transcript) {
      transcript = (await adapter.transcribe(await audioStore(root).read(claimed), 'audio/wav')).text;
      if (typeof transcript !== 'string' || !transcript.trim() || transcript.length > 2000) throw new Error('Transcript unavailable');
      const saved = db.prepare("UPDATE recordings SET transcript=? WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?")
        .run(transcript.trim(), claimed.id, claimed.leaseToken, NOW());
      if (!saved.changes) return true;
    }
    const question = claimed.presented_question || snapshot.languages?.[assignment.language]?.question || snapshot.question;
    const assessment = await adapter.assess(transcript, question, askedFacts);
    if (!['matched', 'clarification', 'unassessable'].includes(assessment?.outcome)
      || !Array.isArray(assessment.reasons) || !assessment.reasons.every((reason) => typeof reason === 'string' && reason.length <= 300)) {
      throw new Error('Assessment unavailable');
    }
    transaction(db, () => {
      if (!db.prepare("SELECT id FROM recordings WHERE id=? AND status='processing' AND lease_token=? AND lease_until>?")
        .get(claimed.id, claimed.leaseToken, NOW())) return;
      if (!db.prepare(`SELECT w.id FROM assignments a JOIN workers w ON w.id=a.worker_id
        WHERE a.id=? AND w.active=1`).get(claimed.assignment_id)) {
        db.prepare("UPDATE recordings SET status='blocked',lease_until=NULL,lease_token=NULL,error='Assignment unavailable' WHERE id=?").run(claimed.id);
        return;
      }
      const old = db.prepare('SELECT id FROM attempts WHERE assignment_id=? AND submission_id=?')
        .get(claimed.assignment_id, claimed.submission_id);
      if (!old) {
        const attemptId = randomUUID(), now = NOW();
        db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)').run(attemptId, claimed.org_id,
          claimed.assignment_id, claimed.submission_id, transcript.trim(), assessment.outcome,
          JSON.stringify({ reasons: assessment.reasons, evidence: assessment.evidence || [], recordingId: claimed.id }), claimed.received_at || claimed.created_at);
        if(claimed.presentation_id && claimed.presentation_language && claimed.presented_question){
          recordPresentationBinding(db,attemptId,{id:claimed.presentation_id,org_id:claimed.org_id,site_id:claimed.site_id,
            assignment_id:claimed.assignment_id,target_language:claimed.presentation_language,
            question:claimed.presented_question},now);
        }
        if (assessment.outcome !== 'matched') {
          const caseId=randomUUID();db.prepare('INSERT INTO clarifications VALUES (?,?,?,?,?,?,?,?,?)')
          .run(caseId, claimed.org_id, claimed.assignment_id, attemptId,
            assessment.reasons[0] || 'AI check needs clarification', null, 'open', '', now);
          routeNewCase(db,claimed.org_id,claimed.site_id,caseId);
          staffAuditOnce(db,{orgId:claimed.org_id,siteId:claimed.site_id,action:'answer.needs_attention',objectId:caseId,now});
        }
        db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), claimed.org_id,
          claimed.site_id, 'system', 'ai-worker', 'answer.checked', attemptId, now);
      }
      db.prepare("UPDATE recordings SET status='transcribed',lease_until=NULL,lease_token=NULL,retry_at=NULL,error=NULL WHERE id=?")
        .run(claimed.id);
    });
  } catch (error) {
    const final = claimed.attempts >= MAX_ATTEMPTS;
    db.prepare("UPDATE recordings SET status=?,lease_until=NULL,lease_token=NULL,retry_at=?,error=? WHERE id=? AND status='processing' AND lease_token=?")
      .run(final ? 'failed' : 'received', final ? null : new Date(Date.now() + claimed.attempts * 15_000).toISOString(),
        'Recording AI processing failed', claimed.id, claimed.leaseToken);
  }
  return true;
}
