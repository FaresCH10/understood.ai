import { openDatabase } from '../server/db.mjs';
import { scheduleAuthority } from '../server/schedules.mjs';
import { scheduleHash } from '../server/schedule-input.mjs';

const ORG = 'cedar';
const SITE = 'beirut';
const STAFF = 'maya';
const DAY = 86400000;

function workerRange(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

const instructions = [
  {
    slug: 'morning', briefingId: 'cal-shelf-morning', publicationId: 'cal-shelf-morning-v1', version: 1,
    title: 'Shelf colour handover · morning shift',
    titleAr: 'تسليم ألوان الرفوف · وردية الصباح', titleUr: 'شیلف رنگ حوالگی · صبح کی شفٹ',
    created: '2026-10-01T04:20:00.000Z', published: '2026-10-02T05:15:00.000Z',
    workers: workerRange(1, 18), responses: 14, acks: [16, 18], completions: 6,
    clarifications: [{ index: 4, status: 'open', reason: 'Missing fact' }, { index: 9, status: 'resolved', reason: 'Unclear audio', resolvedAt: '2026-10-05T07:45:00.000Z' }],
    edits: ['2026-10-01T09:10:00.000Z'],
  },
  {
    slug: 'walkway', briefingId: 'cal-walkway-check', publicationId: 'cal-walkway-check-v1', version: 1,
    title: 'Walkway clear check', titleAr: 'فحص خلو الممر', titleUr: 'راستہ صاف ہونے کی جانچ',
    created: '2026-10-05T05:00:00.000Z', published: '2026-10-06T06:00:00.000Z',
    workers: workerRange(2, 22), responses: 17, acks: [19, 21], completions: 7,
    clarifications: [{ index: 6, status: 'open', reason: 'Help requested' }, { index: 11, status: 'resolved', reason: 'Missing fact', resolvedAt: '2026-10-09T08:20:00.000Z' }],
    edits: [],
  },
  {
    slug: 'evening', briefingId: 'cal-shelf-evening', publicationId: 'cal-shelf-evening-v1', version: 1,
    title: 'Shelf handover · evening shift',
    titleAr: 'تسليم الرفوف · وردية المساء', titleUr: 'شیلف حوالگی · شام کی شفٹ',
    created: '2026-10-11T06:00:00.000Z', published: '2026-10-12T05:30:00.000Z',
    workers: workerRange(10, 30), responses: 17, acks: [29, 30], completions: 6,
    clarifications: [{ index: 13, status: 'open', reason: 'Unclear audio' }],
    edits: ['2026-10-11T11:00:00.000Z'],
  },
  {
    slug: 'refresher-v1', briefingId: 'cal-shelf-refresher', publicationId: 'cal-shelf-refresher-v1', version: 1,
    title: 'Blue and yellow shelf refresher', titleAr: 'تذكير بالرف الأزرق والأصفر', titleUr: 'نیلی اور پیلی شیلف کی یاد دہانی',
    created: '2026-10-16T04:30:00.000Z', published: '2026-10-17T07:00:00.000Z',
    workers: workerRange(1, 30), responses: 19, acks: [26, 27, 28], completions: 8,
    clarifications: [{ index: 7, status: 'open', reason: 'Missing fact' }, { index: 15, status: 'resolved', reason: 'Unclear audio', resolvedAt: '2026-10-20T06:50:00.000Z' }],
    edits: [],
  },
  {
    slug: 'refresher-v2', briefingId: 'cal-shelf-refresher', publicationId: 'cal-shelf-refresher-v2', version: 2,
    title: 'Blue and yellow shelf refresher', titleAr: 'تذكير بالرف الأزرق والأصفر', titleUr: 'نیلی اور پیلی شیلف کی یاد دہانی',
    created: '2026-10-16T04:30:00.000Z', published: '2026-10-22T06:10:00.000Z',
    workers: workerRange(1, 30), responses: 24, acks: [28, 29, 30], completions: 11,
    clarifications: [
      { index: 9, status: 'open', reason: 'Help requested' },
      { index: 18, status: 'resolved', reason: 'Missing fact', resolvedAt: '2026-10-26T07:15:00.000Z' },
      { index: 23, status: 'open', reason: 'Unclear audio' },
    ],
    edits: ['2026-10-21T10:20:00.000Z'],
  },
  {
    slug: 'weekend', briefingId: 'cal-weekend-handover', publicationId: 'cal-weekend-handover-v1', version: 1,
    title: 'Weekend shelf handover', titleAr: 'تسليم رفوف نهاية الأسبوع', titleUr: 'ویک اینڈ شیلف حوالگی',
    created: '2026-10-23T05:10:00.000Z', published: '2026-10-24T06:30:00.000Z',
    workers: workerRange(1, 15), responses: 12, acks: [14, 15], completions: 5,
    clarifications: [{ index: 11, status: 'open', reason: 'Missing fact' }],
    edits: ['2026-10-23T09:40:00.000Z'],
  },
];

const answers = {
  matched: 'Finished items go on the blue shelf and unfinished items on the yellow shelf.',
  clarification: 'I am not sure which shelf to use for the unfinished items.',
  unassessable: 'The shelves near the door still need checking.',
};
const reasons = { matched: ['asked_facts_present'], clarification: ['missing_asked_fact'], unassessable: ['unsupported_wording'] };

function responseStamp(published, index) {
  const base = Date.parse(published);
  const day = index < 6 ? 0 : index < 11 ? 1 : index < 16 ? 2 : 3;
  const minutes = 55 + (index * 47) % (9 * 60);
  return new Date(base + day * DAY + minutes * 60000).toISOString();
}

function snapshotFor(base, title, titleAr, titleUr) {
  const languages = { ...base.languages };
  for (const [code, label] of [['en', title], ['ar', titleAr], ['ur', titleUr]]) languages[code] = { ...base.languages[code], title: label };
  return { ...base, title, languages };
}

export function seedCalendarHistory(db) {
  const basePublication = db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3' AND org_id=? AND site_id=?").get(ORG, SITE);
  if (!basePublication) throw new Error('The demo shelf publication is required before seeding calendar history.');
  const base = JSON.parse(basePublication.snapshot_json);
  const workers = new Map();
  for (const row of db.prepare('SELECT id,code,name,language FROM workers WHERE org_id=? AND site_id=? AND active=1').all(ORG, SITE)) {
    if (/^worker-\d+$/.test(row.id)) workers.set(Number(row.id.slice(7)), row);
  }
  const required = new Set([...instructions.flatMap((item) => item.workers), ...workerRange(1, 12)]);
  for (const number of required) if (!workers.has(number)) throw new Error(`Missing demo worker worker-${number}.`);

  const inserted = { briefings: 0, publications: 0, assignments: 0, attempts: 0, clarifications: 0, acknowledgments: 0, completions: 0, audit: 0, schedules: 0 };
  const hasBriefing = db.prepare('SELECT 1 FROM briefings WHERE id=?');
  const addAudit = db.prepare('INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at) VALUES(?,?,?,?,?,?,?,?)');
  const audit = (id, action, objectId, occurredAt) => {
    addAudit.run(id, ORG, SITE, 'staff', STAFF, action, objectId, occurredAt);
    inserted.audit += 1;
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of instructions) {
      if (!hasBriefing.get(item.briefingId)) {
        const snapshot = snapshotFor(base, item.title, item.titleAr, item.titleUr);
        const versions = instructions.filter((entry) => entry.briefingId === item.briefingId).map((entry) => entry.version);
        db.prepare('INSERT INTO briefings(id,org_id,site_id,title,source,revision,next_version,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(item.briefingId, ORG, SITE, item.title, base.source, 1, Math.max(...versions) + 1, 'draft', null, item.created, item.created);
        inserted.briefings += 1;
        audit(`cal-audit-${item.briefingId}-created`, 'briefing.created', item.briefingId, item.created);
      }
      if (db.prepare('SELECT 1 FROM publications WHERE id=?').get(item.publicationId)) continue;

      const snapshot = snapshotFor(base, item.title, item.titleAr, item.titleUr);
      const superseded = instructions.some((entry) => entry.briefingId === item.briefingId && entry.version > item.version);
      db.prepare('INSERT INTO publications(id,org_id,site_id,briefing_id,version,snapshot_json,published_at,state) VALUES(?,?,?,?,?,?,?,?)')
        .run(item.publicationId, ORG, SITE, item.briefingId, item.version, JSON.stringify(snapshot), item.published, superseded ? 'superseded' : 'published');
      inserted.publications += 1;

      const addAssignment = db.prepare('INSERT INTO assignments(id,org_id,site_id,publication_id,worker_id,due_at,created_at,language) VALUES(?,?,?,?,?,?,?,?)');
      const addAttempt = db.prepare('INSERT INTO attempts(id,org_id,assignment_id,submission_id,answer_text,outcome,reasons_json,received_at) VALUES(?,?,?,?,?,?,?,?)');
      const addClarification = db.prepare('INSERT INTO clarifications(id,org_id,assignment_id,attempt_id,reason,owner_staff_id,status,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
      const addAcknowledgment = db.prepare('INSERT INTO acknowledgments(request_id,org_id,site_id,assignment_id,worker_id,received_at) VALUES(?,?,?,?,?,?)');
      const addCompletion = db.prepare('INSERT INTO assignment_completions(assignment_id,org_id,site_id,worker_id,completed_at) VALUES(?,?,?,?,?)');

      const assignmentIds = new Map();
      for (const number of item.workers) {
        const worker = workers.get(number);
        const assignmentId = `cal-${item.slug}-a-${number}`;
        assignmentIds.set(number, assignmentId);
        addAssignment.run(assignmentId, ORG, SITE, item.publicationId, worker.id,
          new Date(Date.parse(item.published) + 2 * DAY).toISOString(), item.published, worker.language);
        inserted.assignments += 1;
      }

      const responders = item.workers.slice(0, item.responses);
      const clarifications = new Map(item.clarifications.map((entry) => [entry.index, entry]));
      for (const [index, number] of responders.entries()) {
        const attemptId = `cal-${item.slug}-attempt-${number}`;
        const receivedAt = responseStamp(item.published, index);
        const clarification = clarifications.get(index);
        const outcome = !clarification ? 'matched' : clarification.reason === 'Unclear audio' ? 'unassessable' : 'clarification';
        addAttempt.run(attemptId, ORG, assignmentIds.get(number), `cal-${item.slug}-submission-${number}`,
          answers[outcome], outcome, JSON.stringify(reasons[outcome]), receivedAt);
        inserted.attempts += 1;
        if (clarification) {
          const clarificationId = `cal-${item.slug}-clarification-${number}`;
          addClarification.run(clarificationId, ORG, assignmentIds.get(number), attemptId, clarification.reason, STAFF, clarification.status, '', receivedAt);
          inserted.clarifications += 1;
          if (clarification.resolvedAt) audit(`cal-${item.slug}-resolved-${number}`, 'clarification.resolved', clarificationId, clarification.resolvedAt);
        }
        if (index < item.completions) {
          addCompletion.run(assignmentIds.get(number), ORG, SITE, workers.get(number).id,
            new Date(Date.parse(receivedAt) + (25 + index * 7) * 60000).toISOString());
          inserted.completions += 1;
        }
      }
      for (const [index, number] of item.acks.entries()) {
        if (!assignmentIds.has(number)) continue;
        addAcknowledgment.run(`cal-${item.slug}-ack-${number}`, ORG, SITE, assignmentIds.get(number), workers.get(number).id,
          new Date(Date.parse(item.published) + (40 + index * 65) * 60000).toISOString());
        inserted.acknowledgments += 1;
      }
      for (const [index, editedAt] of item.edits.entries()) audit(`cal-${item.slug}-edited-${index}`, 'briefing.edited', item.briefingId, editedAt);
    }

    if (!hasBriefing.get('cal-shelf-next')) {
      const title = 'Shelf handover · next shift';
      const titleAr = 'تسليم الرفوف · الوردية القادمة';
      const titleUr = 'شیلف حوالگی · اگلی شفٹ';
      const snapshot = snapshotFor(base, title, titleAr, titleUr);
      const created = '2026-10-29T06:20:00.000Z';
      db.prepare('INSERT INTO briefings(id,org_id,site_id,title,source,revision,next_version,state,prepared_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run('cal-shelf-next', ORG, SITE, title, base.source, 1, 1, 'ready', JSON.stringify(snapshot), created, created);
      inserted.briefings += 1;
      audit('cal-audit-cal-shelf-next-created', 'briefing.created', 'cal-shelf-next', created);

      const recipients = workerRange(1, 12).map((number) => workers.get(number));
      const request = {
        requestId: 'cal-schedule-shelf-next', revision: 1, nextVersion: 1,
        workerIds: recipients.map((worker) => worker.id), dueAt: '2026-11-06T12:00:00.000Z',
        reminderMinutes: 60, publishAt: '2026-11-04T07:00:00.000Z',
      };
      const session = { org_id: ORG, site_id: SITE, principal_type: 'staff', principal_id: STAFF, role: 'owner' };
      db.prepare(`INSERT INTO publication_schedules(id,org_id,site_id,briefing_id,request_json,snapshot_hash,recipients_json,
        requested_by,authority_json,publish_at,created_at,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued')`)
        .run('cal-schedule-shelf-next', ORG, SITE, 'cal-shelf-next', JSON.stringify(request), scheduleHash(snapshot),
          JSON.stringify(recipients), STAFF, JSON.stringify(scheduleAuthority(db, session)), request.publishAt, '2026-10-30T06:30:00.000Z');
      inserted.schedules += 1;
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return inserted;
}

if (process.argv[1]?.endsWith('calendar-demo-seed.mjs')) {
  const db = openDatabase();
  const result = seedCalendarHistory(db);
  console.log('Calendar demo history seeded:', result);
  db.close();
}
