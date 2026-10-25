import {requireWorkerSiteAccess} from './site-access.mjs';
import { randomUUID } from 'node:crypto';
import {captureReportAudience} from './report-scope.mjs';
import { NOW, transaction } from './db.mjs';
import { ensureRecordingSchema, isCurrentRecording, responseColumns } from './recordings.mjs';
import { publicationInput,readySnapshot,withdrawalInput } from './briefing-input.mjs';
import { briefingAuthority,briefingAudit,assertBriefingActive } from './preparation.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {assertGlossaryCurrent} from './glossary-input.mjs';
import {scheduleHash} from './schedule-input.mjs';
import {queuePublicationReminders} from './reminders.mjs';
import {routeNewCase} from './case-routing.mjs';
import {instructionModes} from './instruction-schema.mjs';
import {checkedPresentationBinding,recordPresentationBinding} from './presentations.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {recordWorkerEvent,staffAuditOnce} from './notification-events.mjs';

export const CANONICAL_SOURCE = 'Put finished items on the blue shelf. Put unfinished items on the yellow shelf. Leave the walkway clear.';
export const QUESTION = 'Where will you put finished and unfinished items?';

export function syntheticPrepare(source) {
  if (source.trim() !== CANONICAL_SOURCE) {
    throw new Error('The local synthetic processor supports only the seeded shelf-colour example. No AI result was generated.');
  }
  return {
    title: 'Shelf colour handover',
    source,
    facts: ['Finished items go on the blue shelf.', 'Unfinished items go on the yellow shelf.', 'Leave the walkway clear.'],
    question: QUESTION,
    rubric: { askedFacts: ['finished -> blue shelf', 'unfinished -> yellow shelf'] },
    languages: {
      en: { title: 'Shelf colour handover', text: source, question: QUESTION, speech: 'device-synthesis-demo' },
      ar: { title: 'تسليم ألوان الرفوف', text: 'ضع المنتجات المكتملة على الرف الأزرق، وغير المكتملة على الرف الأصفر. أبقِ الممر خالياً.', question: 'أين ستضع الأشياء المكتملة وغير المكتملة؟', speech: 'device-synthesis-demo' },
      ur: { title: 'شیلف کے رنگوں کی حوالگی', text: 'مکمل اشیا نیلی شیلف پر اور نامکمل اشیا پیلی شیلف پر رکھیں۔ راستہ صاف رکھیں۔', question: 'آپ مکمل اور نامکمل اشیا کہاں رکھیں گے؟', speech: 'device-synthesis-demo' },
    },
    provenance: { adapter: 'synthetic-local-v1', live: false },
  };
}

export function assessAnswer(answer) {
  const raw = answer.normalize('NFKC').replace(/[\u064b-\u065f]/g, '').trim();
  if (/[\u0600-\u06ff]/.test(raw)) {
    if (/\b(?:نہیں|نہ)\b|ليس|لا تضع|تحت|فوق|بجانب|قرب|نیچے|اوپر|قریب|پاس|سرخ|سبز|الأحمر|الأخضر/.test(raw)) {
      return { outcome: 'clarification', reasons: ['uncertain_placement'] };
    }
    if (/نامکمل/.test(raw)) {
      const clauses = raw.split(/اور|،|,|؛/);
      const finishedBlue = clauses.some((part) => /(?<!نا)مکمل/.test(part) && /نیلی|نیلے/.test(part) && !/پیلی|پیلے/.test(part));
      const unfinishedYellow = clauses.some((part) => /نامکمل/.test(part) && /پیلی|پیلے/.test(part) && !/نیلی|نیلے/.test(part));
      const swapped = clauses.some((part) => /(?<!نا)مکمل/.test(part) && /پیلی|پیلے/.test(part) && !/نیلی|نیلے/.test(part)
        || /نامکمل/.test(part) && /نیلی|نیلے/.test(part) && !/پیلی|پیلے/.test(part));
      return swapped ? { outcome: 'clarification', reasons: ['contradictory_placement'] }
        : finishedBlue && unfinishedYellow ? { outcome: 'matched', reasons: ['asked_facts_present'] }
          : { outcome: 'clarification', reasons: ['missing_asked_fact'] };
    }
    if (/المكتملة/.test(raw)) {
      const clauses = raw.split(/(?=وغير)|،|,|؛/);
      const finishedBlue = clauses.some((part) => /(?<!غير )المكتملة/.test(part) && /الأزرق/.test(part) && !/الأصفر/.test(part));
      const unfinishedYellow = clauses.some((part) => /غير\s*المكتملة/.test(part) && /الأصفر/.test(part) && !/الأزرق/.test(part));
      const swapped = clauses.some((part) => /(?<!غير )المكتملة/.test(part) && /الأصفر/.test(part) && !/الأزرق/.test(part)
        || /غير\s*المكتملة/.test(part) && /الأزرق/.test(part) && !/الأصفر/.test(part));
      return swapped ? { outcome: 'clarification', reasons: ['contradictory_placement'] }
        : finishedBlue && unfinishedYellow ? { outcome: 'matched', reasons: ['asked_facts_present'] }
          : { outcome: 'clarification', reasons: ['missing_asked_fact'] };
    }
    return { outcome: 'unassessable', reasons: ['unsupported_wording'] };
  }
  const normalized = raw.toLowerCase().replace(/[^a-z\s,.;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return { outcome: 'unassessable', reasons: ['empty_answer'] };
  if (/ignore|mark (it )?correct|rubric|system prompt/.test(normalized)) {
    return { outcome: 'unassessable', reasons: ['instruction_like_answer'] };
  }
  if (/\b(?:not|never|don t|do not|near|beside|by|under|above|below|behind|front|floor|next|red|green|orange|other|maybe|perhaps|instead)\b/.test(normalized)) {
    return { outcome: 'clarification', reasons: ['uncertain_placement'] };
  }
  const clauses = normalized.split(/\b(?:and|but)\b|[.;,]/).filter(Boolean);
  const finished = /\b(finished|completed)\b/;
  const unfinished = /\b(unfinished|incomplete)\b/;
  const blue = /\bblue\b/;
  const yellow = /\byellow\b/;
  const placed = (part, color) => new RegExp(`\\b(?:on|onto|to|in)\\s+(?:the\\s+)?${color}\\s+shelf\\b`).test(part);
  const concise = (part, subject, color) => new RegExp(`^\\s*(?:${subject})\\s+${color}(?:\\s+shelf)?\\s*$`).test(part);
  const finishedBlue = clauses.some((part) => finished.test(part) && blue.test(part) && !yellow.test(part)
    && (placed(part, 'blue') || concise(part, 'finished|completed', 'blue')));
  const unfinishedYellow = clauses.some((part) => unfinished.test(part) && yellow.test(part) && !blue.test(part)
    && (placed(part, 'yellow') || concise(part, 'unfinished|incomplete', 'yellow')));
  const swapped = clauses.some((part) => finished.test(part) && yellow.test(part) || unfinished.test(part) && blue.test(part));
  if (swapped) return { outcome: 'clarification', reasons: ['contradictory_placement'] };
  if (finishedBlue && unfinishedYellow) return { outcome: 'matched', reasons: ['asked_facts_present'] };
  return { outcome: 'clarification', reasons: ['missing_asked_fact'] };
}

export function metrics(db, orgId, publicationId) {
  ensureRecordingSchema(db);
  const rows = db.prepare(`SELECT a.id,${responseColumns}
    FROM assignments a WHERE a.org_id=? AND a.publication_id=?`).all(orgId, publicationId);
  return metricsFromResponses(rows);
}

export function metricsFromResponses(rows) {
  const assigned = rows.length;
  const currentOutcome = (row) => isCurrentRecording(row) ? null : row.outcome;
  const matches = rows.filter((row) => currentOutcome(row) === 'matched').length;
  const clarifications = rows.filter((row) => ['clarification', 'unassessable'].includes(currentOutcome(row))).length;
  const acknowledged = rows.filter((row) => !isCurrentRecording(row) && row.acknowledged_at && !row.outcome && !row.audio_status).length;
  const responses = rows.filter((row) => row.outcome || row.attempt_at || row.audio_status || row.acknowledged_at).length;
  const unassessed = responses - matches - clarifications - acknowledged;
  const result = { assigned, responses, matches, clarifications, unassessed, pending: assigned - responses,
    completion: assigned ? Math.round(responses / assigned * 100) : 0 };
  if (acknowledged) result.acknowledged = acknowledged;
  return result;
}

export function checkedPublication(db,session,briefing,request) {
  assertBriefingActive(db,session,briefing.id);
  if (briefing.revision!==request.revision) throw new Error('Draft revision changed');
  if (!Number.isSafeInteger(request.nextVersion)) throw new Error('Invalid publication version');
  if (briefing.next_version!==request.nextVersion) throw new Error('Draft version changed');
  if (request.dueAt!==null && request.dueAt<=NOW()) throw new Error('Deadline must be in the future');
  const recipient=db.prepare(`SELECT id,language,language_selection_required FROM workers
    WHERE id=? AND org_id=? AND site_id=? AND active=1`);
  const workers=request.workerIds.map((id) => recipient.get(id,session.org_id,session.site_id));
  if (workers.some((worker) => !worker)) throw new Error('Recipient unavailable');
  if (workers.some((worker) => worker.language_selection_required)) throw new Error('Recipient language not selected');
  const snapshot=readySnapshot({...briefing,prepared_json:briefing.prepared_json ? JSON.parse(briefing.prepared_json) : null},workers,'synthetic',
    instructionModes(db,briefing.id,session.org_id,session.site_id));
  assertGlossaryCurrent(snapshot,readGlossarySnapshot(db,session.org_id,session.site_id));
  return {workers,snapshot};
}

export function publish(db, session, briefingId,input,options={}) {
  return transaction(db, () => publishInTransaction(db,session,briefingId,input,options));
}

export function publishInTransaction(db,session,briefingId,input,{scheduleId,verifySchedule}={}) {
  const request=publicationInput(input);
  briefingAuthority(db,session);
    const briefing = db.prepare('SELECT * FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(briefingId, session.org_id, session.site_id);
    if (!briefing) throw new Error('Briefing unavailable');
    const scheduled=scheduleId ? db.prepare('SELECT * FROM publication_schedules WHERE id=? AND briefing_id=? AND org_id=? AND site_id=?')
      .get(scheduleId,briefingId,session.org_id,session.site_id) : null;
    if(scheduleId) {
      if(!scheduled || scheduled.state!=='queued' || scheduled.publish_at>NOW() || (scheduled.retry_at && scheduled.retry_at>NOW())) return null;
      verifySchedule(scheduled,briefing);
    }
    if(!scheduleId && db.prepare('SELECT 1 FROM publication_schedules WHERE id=?').get(input.requestId)) throw Error('Publication request conflict');
    const old=db.prepare(`SELECT r.request_json,p.id,p.version,(SELECT COUNT(*) FROM assignments a WHERE a.publication_id=p.id) AS assigned
      FROM publication_requests r JOIN publications p ON p.id=r.publication_id AND p.org_id=r.org_id AND p.site_id=r.site_id
      WHERE r.request_id=? AND r.briefing_id=? AND r.org_id=? AND r.site_id=?`).get(input.requestId,briefingId,session.org_id,session.site_id);
    if (old) {
      if (old.request_json!==JSON.stringify(request)) throw new Error('Publication request conflict');
      return {id:old.id,version:old.version,assigned:old.assigned,duplicate:true};
    }
    requireWritableEntitlement(db,session.org_id);
    const {workers,snapshot:prepared}=checkedPublication(db,session,briefing,request);
    if(scheduled && (scheduled.snapshot_hash!==scheduleHash(prepared) || scheduled.recipients_json!==JSON.stringify(workers))) throw Error('Scheduled recipient language changed');
    const id = randomUUID();
    const now = NOW();
    db.prepare("UPDATE publications SET state='superseded' WHERE briefing_id=? AND org_id=? AND state='published'").run(briefing.id, session.org_id);
    db.prepare('INSERT INTO publications VALUES (?,?,?,?,?,?,?,?)').run(id, session.org_id, session.site_id, briefing.id, briefing.next_version, JSON.stringify(prepared), now, 'published');
    const insert = db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES (?,?,?,?,?,?,?,?)');
    for (const worker of workers) {
      const assignmentId=randomUUID();
      insert.run(assignmentId, session.org_id, session.site_id, id, worker.id, request.dueAt, now, worker.language);
      recordWorkerEvent(db,{orgId:session.org_id,siteId:session.site_id,workerId:worker.id,kind:'instruction.available',
        objectType:'assignment',objectId:assignmentId,dedupeKey:`instruction.available:${assignmentId}`,now});
    }
    captureReportAudience(db,id);
    queuePublicationReminders(db,session,id,request);
    db.prepare('INSERT INTO publication_requests VALUES(?,?,?,?,?,?)').run(input.requestId,session.org_id,session.site_id,briefing.id,id,JSON.stringify(request));
    db.prepare('UPDATE briefings SET next_version=next_version+1,state=?,updated_at=? WHERE id=?').run('draft', now, briefing.id);
    briefingAudit(db,session,'briefing.published',id);
    if(scheduled) db.prepare("UPDATE publication_schedules SET state='published',publication_id=?,finished_at=?,attempts=attempts+1,retry_at=NULL WHERE id=? AND state='queued'").run(id,now,scheduled.id);
    return { id, version: briefing.next_version, assigned: workers.length,duplicate:false };
}

export function withdrawPublication(db,session,briefingId,input) {
  const request=withdrawalInput(input);
  return transaction(db,() => {
    briefingAuthority(db,session);
    const publication=db.prepare('SELECT id,version,state FROM publications WHERE id=? AND briefing_id=? AND org_id=? AND site_id=?')
      .get(request.publicationId,briefingId,session.org_id,session.site_id);
    if (!publication) throw new Error('Publication unavailable');
    const old=db.prepare('SELECT * FROM publication_withdrawals WHERE request_id=? AND org_id=? AND site_id=?')
      .get(input.requestId,session.org_id,session.site_id);
    if (old) {
      if (old.publication_id!==request.publicationId || old.version!==request.version || old.reason!==request.reason) throw new Error('Withdrawal request conflict');
      return {id:old.publication_id,version:old.version,state:'withdrawn',duplicate:true};
    }
    if (publication.version!==request.version || publication.state!=='published') throw new Error('Publication is no longer current');
    const now=NOW();
    db.prepare("UPDATE publications SET state='withdrawn' WHERE id=?").run(publication.id);
    db.prepare('INSERT INTO publication_withdrawals VALUES(?,?,?,?,?,?,?,?)')
      .run(input.requestId,session.org_id,session.site_id,publication.id,publication.version,request.reason,session.principal_id,now);
    briefingAudit(db,session,'briefing.withdrawn',publication.id);
    return {id:publication.id,version:publication.version,state:'withdrawn',duplicate:false};
  });
}

export function assessKeywordAnswer(answer,rubric) {
  const raw=answer.normalize('NFKC').toLowerCase().trim();
  if(!raw) return {outcome:'unassessable',reasons:['empty_answer']};
  if(/ignore|mark (it )?correct|rubric|system prompt/.test(raw)) return {outcome:'unassessable',reasons:['instruction_like_answer']};
  const groups=Array.isArray(rubric?.keywordGroups) ? rubric.keywordGroups : [];
  const covered=groups.filter((group)=>group.some((word)=>raw.includes(word))).length;
  return covered>=Math.min(2,groups.length) && groups.length
    ? {outcome:'matched',reasons:['asked_facts_present']}
    : {outcome:'clarification',reasons:['missing_asked_fact']};
}

export function submitAnswer(db, session, assignmentId, submissionId, answerText, presentationId = null) {
  if (session.principal_type !== 'worker') throw new Error('Forbidden');
  if (typeof submissionId !== 'string' || !submissionId || submissionId.length > 100) throw new Error('Invalid submission ID');
  if (typeof answerText !== 'string' || answerText.length > 2000) throw new Error('Invalid answer');
  ensureRecordingSchema(db);
  return transaction(db, () => {
    requireWorkerSiteAccess(db,session.org_id,session.site_id);
    const assignment = db.prepare(`SELECT a.*, p.snapshot_json, p.state FROM assignments a
      JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id
      WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`).get(assignmentId, session.org_id, session.site_id, session.principal_id);
    if (!assignment) throw new Error('Assignment unavailable');
    const old = db.prepare('SELECT * FROM attempts WHERE assignment_id=? AND submission_id=?').get(assignmentId, submissionId);
    if (old) {
      if (old.answer_text !== answerText.trim()) throw new Error('Submission ID conflict');
      return { id: old.id, outcome: old.outcome, duplicate: true };
    }
    requireWritableEntitlement(db,session.org_id);
    if (submissionId.length < 8) throw new Error('Invalid submission ID');
    if (assignment.state !== 'published') throw new Error('Assignment unavailable');
    if (assignment.due_at && assignment.due_at<=NOW()) throw new Error('Assignment deadline passed');
    if (db.prepare('SELECT 1 FROM recordings WHERE assignment_id=? AND submission_id=?').get(assignmentId, submissionId))
      throw new Error('Submission ID conflict');
    const snapshot = JSON.parse(assignment.snapshot_json);
    if(snapshot.responseMode==='acknowledge') throw new Error('This instruction only requires confirmation');
    const presentation=checkedPresentationBinding(db,session,assignmentId,presentationId);
    const rubric = snapshot.rubric?.askedFacts;
    const result = snapshot.provenance?.adapter === 'synthetic-local-v1'
      && Array.isArray(rubric) && rubric.join('|') === 'finished -> blue shelf|unfinished -> yellow shelf'
      ? assessAnswer(answerText)
      : snapshot.provenance?.adapter === 'synthetic-instruction-v1' && snapshot.rubric?.mode === 'keywords'
        ? assessKeywordAnswer(answerText,snapshot.rubric)
        : { outcome: 'unassessable', reasons: ['unsupported_rubric'] };
    const id = randomUUID();
    const now = NOW();
    db.prepare('INSERT INTO submission_receipts(org_id,assignment_id,submission_id,kind,received_at) VALUES (?,?,?,?,?)')
      .run(session.org_id, assignmentId, submissionId, 'typed', now);
    db.prepare('INSERT INTO attempts VALUES (?,?,?,?,?,?,?,?)').run(id, session.org_id, assignmentId, submissionId, answerText.trim(), result.outcome, JSON.stringify(result.reasons), now);
    recordPresentationBinding(db,id,presentation,now);
    if (result.outcome !== 'matched') {
      const caseId=randomUUID();
      db.prepare('INSERT INTO clarifications VALUES (?,?,?,?,?,?,?,?,?)').run(caseId, session.org_id, assignmentId, id, result.reasons[0], null, 'open', '', now);
      routeNewCase(db,session.org_id,session.site_id,caseId);
      staffAuditOnce(db,{orgId:session.org_id,siteId:session.site_id,action:'answer.needs_attention',objectId:caseId,now});
    }
    db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), session.org_id, session.site_id, 'worker', session.principal_id, 'answer.received', id, now);
    return { id, outcome: result.outcome, duplicate: false };
  });
}
